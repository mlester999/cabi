import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { aspectRatios } from "@/lib/image-generation/types";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import { imageGenerationTtlMs } from "@/lib/image-generation/cache";
import { offTopicReply, uncertainReply, classifyCabiRelevance, extractScene } from "@/lib/image-generation/scope";
import { checkImageSafety, safetyCodeFor } from "@/lib/image-generation/safety";
import { imageCapabilitiesFor } from "@/lib/image-generation/provider";
import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { parseCabiSceneRequest } from "@/lib/image-generation/parse-scene";
import { readLatestGenerationContext } from "@/lib/image-generation/lifecycle";
import { readImageProviderConfig } from "@/lib/image-generation/settings";
import { createImageProvider } from "@/lib/image-generation/provider";
import { assertSameOrigin, clientAddress, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { guardAppApiCpu } from "@/lib/site/guard";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/**
 * Cabi image generation.
 *
 * Everything that costs money happens after every check has passed:
 *
 *   1. site mode, 2. same-origin, 3. rate limit, 4. authenticated wallet,
 *   5. schema validation, 6. Cabi relevance, 7. daily allowance, 8. provider.
 *
 * A refused or ambiguous request returns `type: "chat_response"` with a friendly
 * line, so the UI renders it as Cabi speaking rather than as an API error — and
 * crucially the provider is never called, so no credit is spent.
 *
 * Character consistency is assembled in ONE place (`buildCabiGenerationPlan`):
 * the fixed identity layers, the requested expression and outfit, the scene, and
 * the official reference image when the configured model can actually use it. A
 * client cannot supply a reference, an expression outside the closed set, or any
 * wording that reaches the identity layers.
 *
 * Provider identity is never disclosed: the response carries no model name, no
 * request id, and no Together-specific detail. Failures are logged server-side
 * and answered with a generic Cabi line.
 */

const requestSchema = z.object({
  prompt: z.string().trim().min(2).max(600),
  aspectRatio: z.enum(aspectRatios as unknown as [string, ...string[]]).default("1:1"),
  conversationId: z.string().uuid().optional(),
  /** Optional client key so a double-submit cannot create two generations. */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

/** The line Cabi uses when a generation genuinely fails, with a retry offered. */
const imageFailureMessage = "That one didn't come out. Want me to try again?";

export async function POST(request: Request) {
  // Image generation is the most expensive protected action, so eligibility is
  // re-read here rather than taken from a cached check: a wallet that dropped
  // below the $CPU minimum since its last request is refused before any
  // provider call is made.
  const blocked = await guardAppApiCpu({ fresh: true });
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }

  // Cheapest check first: a flood never reaches the database or the provider.
  const limited = await checkRateLimit("image.generate", clientAddress(request), 12, 60);
  if (!limited.allowed) {
    return Response.json(
      { type: "chat_response", message: "Slow down a moment, I am still drawing the last one." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "private, no-store" } },
    );
  }

  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }
  // Image generation is tied to a wallet for allowance, ownership and cost
  // control. Guest chat stays free; a guest asks and is told how to unlock it.
  if (!wallet) {
    return jsonError("Connect your wallet to generate Cabi images.", 401, "WALLET_REQUIRED");
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Tell me what you would like me to draw.", 400, "INVALID_INPUT");

  const { prompt, conversationId, idempotencyKey } = parsed.data;
  const aspectRatio = parsed.data.aspectRatio as "1:1" | "16:9" | "9:16";

  const db = getServiceClient();
  if (!db) return jsonError("Image storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  // A double-submit with the same key reuses the first result instead of paying
  // for a second generation.
  if (idempotencyKey) {
    const { data: existing } = await db
      .from("image_generations")
      .select("id,user_prompt,aspect_ratio,image_path,created_at,status")
      .eq("wallet_account_id", wallet.walletAccountId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const prior = existing as { id: string; user_prompt: string; aspect_ratio: string; image_path: string | null; created_at: string; status: string } | null;
    if (prior?.image_path && prior.status === "COMPLETED") {
      const url = await signedImageUrl(generationBucket, prior.image_path, Math.floor(imageGenerationTtlMs / 1_000));
      if (url) {
        return Response.json(
          { type: "image", image: { id: prior.id, url, prompt: prior.user_prompt, aspectRatio: prior.aspect_ratio, createdAt: prior.created_at }, reused: true },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
    }
  }

  // Cabi relevance runs BEFORE any allowance is touched or any provider call is
  // made, so an unrelated request costs nothing.
  const verdict = classifyCabiRelevance(prompt);
  if (verdict !== "CABI_RELATED") {
    return Response.json(
      {
        type: "chat_response",
        verdict,
        message: verdict === "UNCERTAIN" ? uncertainReply(prompt) : offTopicReply(prompt),
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  /*
   * Safety is a separate question from relevance, and both must pass: "Cabi
   * holding a knife" is unmistakably about Cabi and still must not be drawn.
   * Checked before the provider so a refusal costs no call and no allowance.
   */
  const safety = checkImageSafety(extractScene(prompt));
  if (!safety.safe) {
    // Recorded so the admin view can see what is being asked for, without
    // spending a generation on it.
    await db.from("image_generations").insert({
      wallet_account_id: wallet.walletAccountId,
      conversation_id: conversationId ?? null,
      user_prompt: prompt,
      aspect_ratio: aspectRatio,
      provider: "together",
      model: "unknown",
      status: "FAILED",
      failure_code: "SAFETY_REFUSED",
      safety_code: safetyCodeFor(safety),
      failure_message: safety.message,
      failed_at: new Date().toISOString(),
    });
    return Response.json(
      { type: "chat_response", verdict: "UNSAFE", message: safety.message },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // The provider key is read here and nowhere earlier, so a refusal above can
  // never have touched it.
  const providerConfig = await readImageProviderConfig();
  if (!providerConfig) {
    return jsonError("Cabi's image generation hasn't been configured yet.", 503, "IMAGES_NOT_CONFIGURED");
  }

  const { data: quotaData } = await db.rpc("image_generation_quota", {
    p_wallet_account_id: wallet.walletAccountId,
    p_daily_limit: providerConfig.settings.dailyLimit,
  });
  const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as { allowed?: boolean } | undefined;
  if (quota && quota.allowed === false) {
    return Response.json(
      { type: "chat_response", message: `That is all ${providerConfig.settings.dailyLimit} images for today. More tomorrow.` },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  /*
   * Capability decides whether the official reference may be attached. It is read
   * from the selected MODEL, and when it says no, no reference parameter is sent
   * — the character bible alone drives consistency. This is stated in the admin
   * console rather than implied here.
   */
  const capabilities = imageCapabilitiesFor({ provider: providerConfig.settings.provider, model: providerConfig.settings.model });

  // The previous image in this conversation supplies the scene to carry forward,
  // which is what makes "now put yourself in a hoodie" change only the outfit.
  const previous = await readLatestGenerationContext(wallet.walletAccountId, conversationId ?? null).catch(() => null);
  const sceneRequest = parseCabiSceneRequest(prompt, previous);

  const planned = await buildCabiGenerationPlan({
    scene: sceneRequest.scene,
    aspectRatio,
    expression: sceneRequest.expression,
    outfit: sceneRequest.outfit,
    outfitNote: sceneRequest.outfitNote,
    sceneNote: sceneRequest.sceneNote,
    modelSupportsReferenceImages: capabilities.supportsReferenceImages,
  });
  if (!planned.ok) {
    // No reference and no bundled fallback: fail visibly rather than draw a
    // random character.
    return Response.json(
      { type: "chat_response", message: planned.message },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const plan = planned.plan;

  const generationId = crypto.randomUUID();
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
    aspectRatio,
    quality: providerConfig.settings.defaultQuality,
    seed: plan.seed ?? undefined,
    referenceImages: plan.referenceImages,
    preparedPrompt: plan.prompt,
  });

  // Metadata recorded on every row: which reference produced it, what varied, and
  // whether the model could actually condition on the reference. No prompt text.
  const safeMetadata = {
    scene: plan.scene,
    expression: plan.expression,
    outfit: plan.outfit,
    reference_version: plan.reference.version,
    seed: plan.seed,
    reference_conditioned: plan.capabilities.referenceConditioning,
  };

  if (!generated.ok) {
    // Recorded FAILED, which the allowance function does not count, so a
    // provider outage never consumes a user's daily images.
    await db.from("image_generations").insert({
      id: generationId,
      wallet_account_id: wallet.walletAccountId,
      conversation_id: conversationId ?? null,
      user_prompt: prompt,
      aspect_ratio: aspectRatio,
      provider: providerConfig.settings.provider,
      model: providerConfig.settings.model,
      status: "FAILED",
      failure_code: generated.error,
      idempotency_key: idempotencyKey ?? null,
      ...safeMetadata,
    });
    const status = generated.error === "RATE_LIMITED" ? 429 : generated.error === "TIMEOUT" ? 504 : 502;
    // A rate limit is not a failure to report as one: it is Cabi asking for a
    // moment. Anything else leads with her own line and offers a retry, while the
    // specific reason travels alongside it for the message body.
    const message = generated.error === "RATE_LIMITED" ? generated.message : imageFailureMessage;
    return Response.json(
      { type: "chat_response", message, reason: generated.message, retryable: true, retryLabel: "Try Again" },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const uploaded = await uploadGenerationImage({
    walletAccountId: wallet.walletAccountId,
    generationId,
    bytes: generated.image.bytes,
    contentType: generated.image.contentType,
  });
  if (!uploaded.ok) return jsonError("I drew it but could not save it. Try again?", 503, "STORAGE_FAILED");

  const { data: row } = await db
    .from("image_generations")
    .insert({
      id: generationId,
      wallet_account_id: wallet.walletAccountId,
      conversation_id: conversationId ?? null,
      user_prompt: prompt,
      aspect_ratio: aspectRatio,
      image_path: uploaded.path,
      provider: generated.image.provider,
      model: generated.image.model,
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
      idempotency_key: idempotencyKey ?? null,
      ...safeMetadata,
    })
    .select("id,created_at")
    .maybeSingle();

  const url = await signedImageUrl(generationBucket, uploaded.path, Math.floor(imageGenerationTtlMs / 1_000));
  if (!url) return jsonError("I drew it but could not open it. Try again?", 503, "STORAGE_FAILED");

  // Only what the UI needs. No model name, no provider id, no reference path, and
  // no prompt layers — the scene is echoed because the user wrote it.
  return Response.json(
    {
      type: "image",
      image: {
        id: row?.id ?? generationId,
        url,
        prompt: plan.scene,
        aspectRatio,
        createdAt: row?.created_at ?? new Date().toISOString(),
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
