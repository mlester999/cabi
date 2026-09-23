import "server-only";

import { getServiceClient } from "@/lib/db/supabase";

/**
 * Storage for generated Cabi images and profile avatars.
 *
 * Two buckets, both private. Access is always mediated by this module, which
 * runs server-side with the service role and is only ever called for the wallet
 * that owns the object. A user can therefore never read another user's
 * generation even if they learn the path.
 */

export const generationBucket = "cabi-generations";
export const avatarBucket = "avatars";

/**
 * Only extensions this product actually produces. A permissive
 * `[a-z0-9]{2,4}` check would happily accept "html" or "svg", which browsers
 * treat as active content when served from a storage origin.
 */
const allowedExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

function safeExtension(extension: string) {
  const normalized = extension.trim().toLowerCase().replace(/^\./u, "");
  return allowedExtensions.has(normalized) ? normalized : "png";
}

/** Deterministic, owner-scoped object path. Never derived from user text. */
export function generationPath(walletAccountId: string, generationId: string, extension: string) {
  return `${walletAccountId}/${generationId}.${safeExtension(extension)}`;
}

export function avatarPath(walletAccountId: string, extension: string) {
  return `${walletAccountId}/avatar.${safeExtension(extension)}`;
}

function extensionFor(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

export type UploadResult = { ok: true; path: string } | { ok: false; message: string };

export async function uploadGenerationImage(input: {
  walletAccountId: string;
  generationId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<UploadResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, message: "Storage isn't configured." };
  const path = generationPath(input.walletAccountId, input.generationId, extensionFor(input.contentType));
  const { error } = await db.storage.from(generationBucket).upload(path, input.bytes, { contentType: input.contentType, upsert: true });
  if (error) return { ok: false, message: "Cabi couldn't save that image." };
  return { ok: true, path };
}

export async function uploadAvatar(input: {
  walletAccountId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<UploadResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, message: "Storage isn't configured." };
  const path = avatarPath(input.walletAccountId, extensionFor(input.contentType));
  const { error } = await db.storage.from(avatarBucket).upload(path, input.bytes, { contentType: input.contentType, upsert: true });
  if (error) return { ok: false, message: "Cabi couldn't save that picture." };
  return { ok: true, path };
}

export async function deleteGenerationImage(path: string) {
  const db = getServiceClient();
  if (!db) return false;
  const { error } = await db.storage.from(generationBucket).remove([path]);
  return !error;
}

/**
 * Short-lived signed URL for one object.
 *
 * Signed rather than public: a generated image is private by default, and a URL
 * that leaks stops working.
 */
export async function signedImageUrl(bucket: string, path: string, expiresInSeconds = 3_600) {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Validates an uploaded avatar server-side.
 *
 * Checks the real magic bytes rather than trusting the declared content type, so
 * a renamed file cannot get through. Size is capped before anything is stored.
 */
export type AvatarValidation =
  | { ok: true; contentType: "image/png" | "image/jpeg" | "image/webp"; extension: string }
  | { ok: false; message: string };

export const avatarMaxBytes = 2 * 1024 * 1024;

export function validateAvatarBytes(bytes: Uint8Array): AvatarValidation {
  if (bytes.byteLength === 0) return { ok: false, message: "That file was empty." };
  if (bytes.byteLength > avatarMaxBytes) return { ok: false, message: "That picture is too large. Keep it under 2 MB." };
  if (bytes.byteLength < 12) return { ok: false, message: "That does not look like an image." };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ok: true, contentType: "image/png", extension: "png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, contentType: "image/jpeg", extension: "jpg" };
  }
  // RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { ok: true, contentType: "image/webp", extension: "webp" };
  }
  return { ok: false, message: "Use a PNG, JPEG, or WebP image." };
}

/**
 * Strips EXIF/metadata segments from a JPEG.
 *
 * Camera and phone photos frequently carry GPS coordinates. Nothing in this
 * product needs them, so they are removed before storage rather than being
 * preserved by default.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return bytes;
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // Start of scan: everything after this is entropy-coded image data.
    if (marker === 0xda) {
      chunks.push(bytes.subarray(offset));
      return concat(chunks);
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.byteLength) break;
    // APP1..APP15 and comment segments carry metadata; drop them.
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) chunks.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  chunks.push(bytes.subarray(offset));
  return concat(chunks);
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}