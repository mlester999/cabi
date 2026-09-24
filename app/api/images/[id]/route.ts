import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { cardUrlTtlSeconds, deleteGeneration, readGeneration, readQuota } from "@/lib/image-generation/lifecycle";
import { readImageSettings } from "@/lib/image-generation/settings";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

/**
 * One generated image.
 *
 * GET returns only what the card needs, with a FRESH signed URL minted from the
 * stored object path — never the provider's temporary URL, and never the URL
 * that was current when the image was first shown.
 *
 * DELETE verifies ownership as part of the operation rather than as a check
 * afterwards, and removes both the storage object and the row. Wallet A cannot
 * read or delete wallet B's image: the ownership predicate is in every query.
 */
export async function GET(_request: Request, { params }: Params) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return jsonError("Invalid image id.", 400, "INVALID_INPUT");

  const generation = await readGeneration(auth.identity.walletAccountId, id);
  if (!generation) return jsonError("That image doesn't exist.", 404, "NOT_FOUND");

  if (generation.status !== "COMPLETED" || !generation.imagePath) {
    // An unfinished or failed generation is reported as its state, so the UI can
    // render a retry instead of a broken image.
    return Response.json(
      { generation: { id: generation.id, status: generation.status, prompt: generation.prompt, aspectRatio: generation.aspectRatio, failureMessage: generation.failureMessage } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const settings = await readImageSettings();
  const [url, quota] = await Promise.all([
    signedImageUrl(generationBucket, generation.imagePath, cardUrlTtlSeconds),
    readQuota(auth.identity.walletAccountId, settings.dailyLimit),
  ]);
  if (!url) return jsonError("I couldn't open that image.", 503, "STORAGE_FAILED");

  return Response.json(
    {
      generation: {
        id: generation.id,
        status: generation.status,
        prompt: generation.prompt,
        aspectRatio: generation.aspectRatio,
        createdAt: generation.createdAt,
        url,
      },
      quota,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return jsonError("Invalid image id.", 400, "INVALID_INPUT");

  const result = await deleteGeneration(auth.identity.walletAccountId, id);
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return jsonError("That image doesn't exist.", 404, "NOT_FOUND");
    return jsonError("I couldn't remove that image.", 503, "STORAGE_FAILED");
  }

  // Usage logging is telemetry, not durability: a logging outage must not make a
  // successful delete look failed. The storage bucket is the same one the
  // generation was written to.
  const db = getServiceClient();
  if (db) {
    await db.from("usage_logs").insert({ provider: "cabi-actions", model: "image-delete", status: "success" });
  }
  return Response.json({ ok: true, bucket: generationBucket }, { headers: { "Cache-Control": "private, no-store" } });
}