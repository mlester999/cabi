import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import {
  cabiReferencePathFor,
  cabiSystemBucket,
  type CabiReferenceRow,
} from "@/lib/cabi/reference/types";

/**
 * Storage access for the official Cabi reference.
 *
 * The bucket is private and every read is mediated here with the service role, so
 * the reference is never exposed as a public object URL. The admin console views
 * it through a short-lived signed URL and the image pipeline downloads the bytes
 * server-side.
 */

/** How long an admin preview link stays valid. */
export const cabiReferenceSignedUrlTtlSeconds = 60 * 60;

export type CabiReferenceUpload =
  | { ok: true; path: string }
  | { ok: false; message: string };

export async function uploadCabiReference(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<CabiReferenceUpload> {
  const db = getServiceClient();
  if (!db) return { ok: false, message: "Storage isn't configured." };
  const path = cabiReferencePathFor(input.mimeType);
  // `upsert` so replacing the canonical slot always succeeds; the previous
  // version is preserved separately as its own versioned object.
  const { error } = await db.storage
    .from(cabiSystemBucket)
    .upload(path, input.bytes, { contentType: input.mimeType, upsert: true });
  if (error) return { ok: false, message: "Cabi couldn't save that reference image." };
  return { ok: true, path };
}

/**
 * Copies the canonical slot to an immutable versioned path.
 *
 * Versioning without a copy would mean "restore previous" was impossible: the
 * slot is overwritten on every upload, so the earlier bytes would be gone. The
 * copy happens BEFORE the new upload, so a failure leaves the old reference
 * intact.
 */
export async function archiveCabiReference(input: { fromPath: string; version: number }): Promise<boolean> {
  const db = getServiceClient();
  if (!db) return false;
  try {
    const { data, error } = await db.storage.from(cabiSystemBucket).download(input.fromPath);
    if (error || !data) return false;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength === 0) return false;
    const extension = input.fromPath.split(".").pop() ?? "png";
    const { error: uploadError } = await db.storage
      .from(cabiSystemBucket)
      .upload(`official/versions/cabi-reference-v${input.version}.${extension}`, bytes, { upsert: true });
    return !uploadError;
  } catch {
    return false;
  }
}

export async function signedCabiReferenceUrl(path: string, expiresInSeconds = cabiReferenceSignedUrlTtlSeconds) {
  const db = getServiceClient();
  if (!db) return null;
  try {
    const { data, error } = await db.storage.from(cabiSystemBucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Downloads the bytes for one stored reference. Returns null when unreadable. */
export async function downloadCabiReference(path: string): Promise<Uint8Array | null> {
  const db = getServiceClient();
  if (!db) return null;
  try {
    const { data, error } = await db.storage.from(cabiSystemBucket).download(path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Reads the pixel dimensions of an image from its header.
 *
 * Deliberately dependency-free: only PNG, JPEG, and WebP are accepted, and all
 * three carry their dimensions near the start of the file. Anything unparseable
 * returns null rather than a guess, and the column is nullable for that reason.
 */
export function readImageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === "image/png" && bytes.byteLength > 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mimeType === "image/webp" && bytes.byteLength > 30) {
      const text = String.fromCharCode(...bytes.subarray(12, 16));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (text === "VP8X") {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
      }
      if (text === "VP8 ") {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (text === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.byteLength) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { width, height };
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (length < 2) return null;
        offset += 2 + length;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** SHA-256 of the image bytes, so an identical re-upload is identifiable. */
export async function hashReferenceBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type { CabiReferenceRow };
