import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { checkImageScope } from "@/lib/image-generation/scope";
import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { createImageProvider, imageCapabilitiesFor } from "@/lib/image-generation/provider";
import { readImageProviderConfig, readImageSettings } from "@/lib/image-generation/settings";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import { aspectRatios } from "@/lib/image-generation/types";
import { awardImageXp, countImageXpToday } from "@/lib/ranking/service";
import { assertSameOrigin, clientAddress, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApiCpu } from "@/lib/site/guard";
import { readWalletAuth } from "@/lib/wallet/session";
import { initialsFor } from "@/lib/profiles/username";
import { readProfile } from "@/lib/profiles/service";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  prompt: z.string().trim().min(3).max(600),
  aspectRatio: z.enum(aspectRatios as unknown as [string, ...string[]]).optional(),
  quality: z.enum(["standard", "high"]).optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Cabi image generation.
 *
 * Enforcement order matters and is deliberate:
 *   1. site mode, 2. same-origin, 3. wallet session, 4. rate limit,
 *   5. Cabi-only scope, 6. daily quota, 7. provider.
 *
 * A request is refused before it can cost anything if it is off-topic, over
 * quota, or from a guest. The provider key is read from encrypted storage on the
 * server and never leaves it.
 */
export async function POST(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("image_generation_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }

  const limited = await checkRateLimit("image.generate", clientAddress(request), 20, 60);
  if (!limited.allowed) {
    return Response.json(
      { error: "Slow down a moment, I am still drawing.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "private, no-store" } },
    );
  }

  const settings = await readImageSettings();
  if (!settings.enabled) return jsonError("Cabi's image studio isn't switched on yet.", 503, "IMAGES_DISABLED");

  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }
  // Generation requires an authenticated wallet so usage is attributable and
  // quota is enforceable. Guest chat stays free; guests get a clear prompt.
  if (!wallet && !settings.allowGuestGeneration) {
    return jsonError("Connect your wallet to generate Cabi images.", 401, "WALLET_REQUIRED");
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Tell me what you would like me to draw.", 400, "INVALID_INPUT");

  // Cabi-only enforcement happens before any provider call.
  const scope = checkImageScope(parsed.data.prompt);
  if (!scope.allowed) {
    if (scope.reason === "BLOCKED_CONTENT") return jsonError(scope.message, 400, "BLOCKED_CONTENT");
    return Response.json(
      { error: scope.message, code: "OFF_TOPIC", suggestion: scope.suggestion },
      { status: 422, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const db = getServiceClient();
  if (!db) return jsonError("Image storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const walletAccountId = wallet?.walletAccountId ?? "00000000-0000-0000-0000-000000000000";
  const aspectRatio = (parsed.data.aspectRatio ?? settings.defaultAspectRatio) as keyof typeof import("@/lib/image-generation/types").aspectRatioSizes;
  const quality = parsed.data.quality ?? settings.defaultQuality;

  // Quota is counted in the database, so two concurrent requests cannot both
  // consume the last slot.
  const { data: quotaData } = await db.rpc("image_generation_quota", {
    p_wallet_account_id: walletAccountId,
    p_daily_limit: settings.dailyLimit,
  });
  const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as { allowed: boolean; remaining: number } | undefined;
  if (wallet && quota && !quota.allowed) {
    return Response.json(
      { error: `That is all ${settings.dailyLimit} images for today. More tomorrow.`, code: "QUOTA_EXCEEDED", remaining: 0 },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const providerConfig = await readImageProviderConfig();
  if (!providerConfig) return jsonError("Cabi's image provider hasn't been configured yet.", 503, "IMAGES_NOT_CONFIGURED");

  const capabilities = imageCapabilitiesFor({
    provider: providerConfig.settings.provider,
    model: providerConfig.settings.model,
  });
  const planned = await buildCabiGenerationPlan({
    scene: scope.scene,
    aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16",
    modelSupportsReferenceImages: capabilities.supportsReferenceImages,
  });
  if (!planned.ok) return jsonError(planned.message, 503, planned.reason);
  const plan = planned.plan;

  const provider = createImageProvider({
    provider: providerConfig.settings.provider,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.settings.baseUrl,
    model: providerConfig.settings.model,
    supportsReferenceImage: capabilities.supportsReferenceImages,
    capabilities,
  });

  const generated = await provider.generateCabiImage({
    scene: plan.scene,
    aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16",
    quality,
    seed: plan.seed ?? undefined,
    negativePrompt: plan.negative,
    referenceImages: plan.referenceImages,
    preparedPrompt: plan.prompt,
  });
  const generationMetadata = {
    reference_version: plan.reference.version,
    reference_conditioned: plan.capabilities.referenceConditioning,
  };
  if (!generated.ok) {
    // A failed call is recorded as FAILED, which the quota function does not
    // count, so a provider outage does not burn the user's allowance.
    await db.from("image_generations").insert({
      wallet_account_id: walletAccountId,
      conversation_id: parsed.data.conversationId ?? null,
      user_prompt: plan.scene,
      aspect_ratio: aspectRatio,
      provider: providerConfig.settings.provider,
      model: providerConfig.settings.model,
      status: "FAILED",
      failure_code: generated.error,
      ...generationMetadata,
    });
    return jsonError(generated.message, generated.error === "RATE_LIMITED" ? 429 : 502, generated.error);
  }

  const generationId = crypto.randomUUID();
  const uploaded = await uploadGenerationImage({
    walletAccountId,
    generationId,
    bytes: generated.image.bytes,
    contentType: generated.image.contentType,
  });
  if (!uploaded.ok) return jsonError(uploaded.message, 503, "STORAGE_FAILED");

  const { data: row } = await db
    .from("image_generations")
    .insert({
      id: generationId,
      wallet_account_id: walletAccountId,
      conversation_id: parsed.data.conversationId ?? null,
      user_prompt: plan.scene,
      aspect_ratio: aspectRatio,
      image_path: uploaded.path,
      provider: generated.image.provider,
      model: generated.image.model,
      status: "COMPLETED",
      ...generationMetadata,
    })
    .select("id,created_at")
    .maybeSingle();

  const url = await signedImageUrl(generationBucket, uploaded.path);
  if (!url) return jsonError("Cabi couldn't open that image.", 503, "STORAGE_FAILED");

  // Image generation earns a small, tightly capped amount of XP: the first of
  // the day only. Expensive API usage must never become a way to farm rank.
  const xp = wallet
    // Counted from the ledger, so only the first image of the day earns XP.
    ? await awardImageXp({ walletAccountId, imagesRewardedToday: await countImageXpToday(walletAccountId), conversationId: parsed.data.conversationId ?? null }).catch(() => null)
    : null;
  const profile = wallet ? await readProfile(walletAccountId) : null;

  return Response.json(
    {
      ok: true,
      image: { id: row?.id ?? generationId, url, prompt: plan.scene, aspectRatio, width: generated.image.width, height: generated.image.height, createdAt: row?.created_at ?? new Date().toISOString() },
      remaining: Math.max(0, (quota?.remaining ?? settings.dailyLimit) - 1),
      // Only surfaced when the award actually happened.
      xp: xp?.xpAwarded ? xp.xpAwarded : null,
      canUseAsAvatar: Boolean(profile?.profileCompletedAt),
      initials: profile?.username ? initialsFor(profile.username) : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
