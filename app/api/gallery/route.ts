import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { deleteGeneration } from "@/lib/image-generation/lifecycle";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's generated Cabi images.
 *
 * Scoped to the session wallet at the query level, so there is no id a caller
 * could pass to read someone else's generation. Images are served through
 * short-lived signed URLs rather than public paths.
 *
 * Only the user's own prompt is returned. The internal character specification
 * is never stored on the row and is never part of a response.
 */
export async function GET() {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("gallery_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const db = getServiceClient();
  if (!db) return jsonError("Image storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const { data } = await db
    .from("image_generations")
    .select("id,user_prompt,aspect_ratio,model,image_path,created_at")
    .eq("wallet_account_id", auth.identity.walletAccountId)
    .eq("status", "COMPLETED")
    .not("image_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as Array<{ id: string; user_prompt: string; aspect_ratio: string; model: string | null; image_path: string; created_at: string }>;
  const images = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    prompt: row.user_prompt,
    aspectRatio: row.aspect_ratio,
    model: row.model,
    createdAt: row.created_at,
    url: await signedImageUrl(generationBucket, row.image_path),
  })));

  return Response.json(
    { images: images.filter((image) => image.url) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Deletes one of the caller's own generations.
 *
 * The ownership predicate is part of the delete itself, so a request naming
 * another user's id removes nothing rather than removing the wrong row.
 */
export async function DELETE(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("gallery_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const result = await deleteGeneration(auth.identity.walletAccountId, parsed.data.id);
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return jsonError("That image doesn't exist.", 404, "NOT_FOUND");
    if (result.reason === "IN_CONTEST") return jsonError("An image submitted to a contest cannot be deleted.", 409, "IMAGE_IN_CONTEST");
    return jsonError("I couldn't remove that image.", 503, "STORAGE_FAILED");
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
