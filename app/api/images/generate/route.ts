import { z } from "zod";

import { generateTogetherImage, resolveTogetherApiKey, resolveTogetherModel } from "@/lib/ai/image/together";
import { getServiceClient } from "@/lib/db/supabase";
import { aspectRatios } from "@/lib/image-generation/types";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import { imageGenerationTtlMs } from "@/lib/image-generation/cache";
import { offTopicReply, uncertainReply, classifyCabiRelevance } from "@/lib/image-generation/scope";
import { assertSameOrigin, clientAddress, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { guardAppApi } from "@/lib/site/guard";
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
 * Provider identity is never disclosed: the response carries no model name, no
 * request id, and no Together-specific detail. Failures are logged server-side
 * and answered with a generic Cabi line.
 */

const dailyLimitDefault = 5;

const requestSchema = z.object({
  prompt: z.string().trim().min(2).max(600),
  aspectRatio: z.enum(aspectRatios as unknown as [string, ...string[]]).default("1:1"),
  conversationId: z.string().uuid().optional(),
  /** Optional client key so a double-submit cannot create two generations. */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

export async function POST(request: Request) {
  const blocked = await guardAppApi();
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
    if (prior?.image_path && prior.status === "SUCCEEDED") {
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

  // The provider key is read here and nowhere earlier, so a refusal above can
  // never have touched it.
  if (!resolveTogetherApiKey()) {
    return jsonError("Cabi's image generation hasn't been configured yet.", 503, "IMAGES_NOT_CONFIGURED");
  }

  const { data: quotaData } = await db.rpc("image_generation_quota", {
    p_wallet_account_id: wallet.walletAccountId,
    p_daily_limit: dailyLimitDefault,
  });
  const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as { allowed?: boolean } | undefined;
  if (quota && quota.allowed === false) {
    return Response.json(
      { type: "chat_response", message: `That is all ${dailyLimitDefault} images for today. More tomorrow.` },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const generated = await generateTogetherImage({ prompt, aspectRatio });
  if (!generated.ok) {
    // Recorded FAILED, which the allowance function does not count, so a
    // provider outage never consumes a user's daily images.
    await db.from("image_generations").insert({
      wallet_account_id: wallet.walletAccountId,
      conversation_id: conversationId ?? null,
      user_prompt: prompt,
      aspect_ratio: aspectRatio,
      provider: "together",
      model: resolveTogetherModel(),
      status: "FAILED",
      failure_code: generated.error,
      idempotency_key: idempotencyKey ?? null,
    });
    const status = generated.error === "RATE_LIMITED" ? 429 : generated.error === "TIMEOUT" ? 504 : 502;
    return Response.json(
      { type: "chat_response", message: generated.message },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const generationId = crypto.randomUUID();
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
      provider: "together",
      model: generated.image.model,
      status: "SUCCEEDED",
      idempotency_key: idempotencyKey ?? null,
    })
    .select("id,created_at")
    .maybeSingle();

  const url = await signedImageUrl(generationBucket, uploaded.path, Math.floor(imageGenerationTtlMs / 1_000));
  if (!url) return jsonError("I drew it but could not open it. Try again?", 503, "STORAGE_FAILED");

  // Only what the UI needs. No model name, no provider id, no request id.
  return Response.json(
    {
      type: "image",
      image: {
        id: row?.id ?? generationId,
        url,
        prompt,
        aspectRatio,
        createdAt: row?.created_at ?? new Date().toISOString(),
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}