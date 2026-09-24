import "server-only";

/**
 * The Cabi official character reference.
 *
 * One image defines what Cabi looks like. It is a system asset with a small,
 * fixed lifecycle:
 *
 *   priority 1: the active admin-uploaded reference (Supabase Storage)
 *   priority 2: the bundled `public/assets/cabi-cpu-model.png`
 *   otherwise:  a visible failure - never a different character
 *
 * The bundled asset is the fallback rather than a silent second choice: it is the
 * shipped Cabi render, committed to the repository, so "no reference" can only
 * mean a deployment that is missing its own files.
 */

/** Private bucket for product-owned assets. Not a user bucket. */
export const cabiSystemBucket = "cabi-system-assets";

/** The canonical object slot for the official reference. */
export const cabiReferenceObjectPath = "official/cabi-reference.png";

/**
 * The shipped fallback reference, relative to /public.
 *
 * This is the priority-2 default required by the product: when no admin reference
 * is active, this exact file is used, and no other image is ever substituted.
 */
export const cabiFallbackReferenceAsset = "/assets/cabi-cpu-model.png";

export type CabiReferenceSource = "ADMIN_UPLOAD" | "BUNDLED";

export type CabiReferenceRow = {
  id: string;
  storagePath: string;
  version: number;
  active: boolean;
  uploadedAt: string;
  uploadedBy: string | null;
  width: number | null;
  height: number | null;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  hash: string;
};

/**
 * The reference the image pipeline actually uses.
 *
 * `bytes` is present only for an admin-uploaded reference, because that is the
 * only case where the server has to fetch the object. The bundled fallback is
 * served from the deployment's own origin and needs no fetch.
 */
export type ResolvedCabiReference = {
  source: CabiReferenceSource;
  /** Version number for the generation metadata; 0 means the bundled fallback. */
  version: number;
  /** Public path (bundled) or storage object path (admin upload). */
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number | null;
  height: number | null;
  /** Present for an admin upload: the actual image bytes. */
  bytes: Uint8Array | null;
  /** Present for an admin upload: a short-lived signed URL. */
  signedUrl: string | null;
  /** True when this reference can be sent to a reference-capable model. */
  conditionable: boolean;
};

export type CabiReferenceUnavailable = {
  ok: false;
  reason: "NO_REFERENCE";
  message: string;
};

/** Admin reference image limits. PNG/JPEG/WebP only, checked by magic bytes. */
export const cabiReferenceMaxBytes = 8 * 1024 * 1024;

export type CabiReferenceValidation =
  | { ok: true; mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: string }
  | { ok: false; message: string };

/**
 * Validates an uploaded reference.
 *
 * The real format is sniffed from the magic bytes, so a renamed file cannot get
 * through, and SVG is rejected outright because browsers treat it as active
 * content when served from a storage origin.
 */
export function validateCabiReferenceBytes(bytes: Uint8Array): CabiReferenceValidation {
  if (bytes.byteLength === 0) return { ok: false, message: "That file was empty." };
  if (bytes.byteLength > cabiReferenceMaxBytes) return { ok: false, message: "That image is too large. Keep it under 8 MB." };
  if (bytes.byteLength < 12) return { ok: false, message: "That does not look like an image." };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ok: true, mimeType: "image/png", extension: "png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { ok: true, mimeType: "image/webp", extension: "webp" };
  }
  return { ok: false, message: "Use a PNG, JPEG, or WebP image. PNG is recommended." };
}

/** `official/cabi-reference.png` is the documented slot for the active upload. */
export function cabiReferencePathFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "official/cabi-reference.jpg";
  if (mimeType === "image/webp") return "official/cabi-reference.webp";
  return cabiReferenceObjectPath;
}

export function cabiReferenceUnavailable(): CabiReferenceUnavailable {
  return {
    ok: false,
    reason: "NO_REFERENCE",
    // A visible failure rather than a random character, exactly as specified.
    message: "Cabi's official reference image is unavailable, so I cannot draw her consistently right now.",
  };
}
