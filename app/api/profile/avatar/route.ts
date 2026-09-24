import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { avatarBucket, stripJpegMetadata, uploadAvatar, validateAvatarBytes } from "@/lib/image-generation/storage";
import { generationBucket } from "@/lib/image-generation/storage";
import { setAvatar as persistAvatar } from "@/lib/profiles/service";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/** Refuses anything larger than this before downloading a byte. */
const maxSourceBytes = 6 * 1024 * 1024;

const bodySchema = z.object({
  /** A generation id, or a data URL for a direct browser upload. */
  generationId: z.string().uuid().optional(),
  dataUrl: z.string().max(9_000_000).optional(),
  remove: z.boolean().optional(),
});

/**
 * Sets the profile picture.
 *
 * Two sources are supported:
 *
 * 1. **A generated Cabi image**, referenced by id. The row is looked up with the
 *    session wallet in the predicate, so a caller cannot adopt someone else's
 *    generation as their avatar.
 * 2. **A direct upload** from the browser, validated on the server by magic
 *    bytes, capped in size, and stripped of EXIF metadata before it is stored.
 *
 * The wallet always comes from the signed session cookie.
 */
export async function POST(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");
  const walletAccountId = auth.identity.walletAccountId;

  if (parsed.data.remove) {
    const ok = await persistAvatar(walletAccountId, null);
    return ok
      ? Response.json({ ok: true, avatarPath: null }, { headers: { "Cache-Control": "private, no-store" } })
      : jsonError("That could not be updated.", 503, "SAVE_FAILED");
  }

  let bytes: Uint8Array | null = null;

  if (parsed.data.generationId) {
    const db = getServiceClient();
    if (!db) return jsonError("Storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
    // Ownership is part of the lookup, not a check afterwards.
    const { data } = await db
      .from("image_generations")
      .select("image_path")
      .eq("id", parsed.data.generationId)
      .eq("wallet_account_id", walletAccountId)
      .maybeSingle();
    const path = data?.image_path as string | undefined;
    if (!path) return jsonError("That image doesn't exist.", 404, "NOT_FOUND");

    const { data: blob, error } = await db.storage.from(generationBucket).download(path);
    if (error || !blob) return jsonError("That image could not be read.", 503, "STORAGE_FAILED");
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else if (parsed.data.dataUrl) {
    const match = parsed.data.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
    if (!match) return jsonError("Use a PNG, JPEG, or WebP image.", 400, "INVALID_IMAGE");
    const binary = atob(match[2]);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  if (!bytes) return jsonError("Nothing to save.", 400, "INVALID_INPUT");
  if (bytes.byteLength > maxSourceBytes) return jsonError("That picture is too large. Keep it under 6 MB.", 413, "TOO_LARGE");

  // Validated by real magic bytes rather than the declared type, so a renamed
  // file cannot get through.
  const validation = validateAvatarBytes(bytes);
  if (!validation.ok) return jsonError(validation.message, 400, "INVALID_IMAGE");

  // EXIF is dropped before storage: phone photos carry GPS coordinates that
  // nothing in this product needs.
  const cleaned = validation.contentType === "image/jpeg" ? stripJpegMetadata(bytes) : bytes;

  const uploaded = await uploadAvatar({ walletAccountId, bytes: cleaned, contentType: validation.contentType });
  if (!uploaded.ok) return jsonError(uploaded.message, 503, "STORAGE_FAILED");

  const saved = await persistAvatar(walletAccountId, uploaded.path);
  if (!saved) return jsonError("That could not be saved.", 503, "SAVE_FAILED");

  return Response.json(
    { ok: true, avatarPath: uploaded.path },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export { avatarBucket };