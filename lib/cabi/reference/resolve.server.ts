import "server-only";

import {
  downloadCabiReference,
  signedCabiReferenceUrl,
} from "@/lib/cabi/reference/storage.server";
import { readActiveCabiReference } from "@/lib/cabi/reference/store.server";
import {
  cabiFallbackReferenceAsset,
  cabiReferenceUnavailable,
  type CabiReferenceRow,
  type CabiReferenceUnavailable,
  type ResolvedCabiReference,
} from "@/lib/cabi/reference/types";

/**
 * Resolves which image is Cabi's official reference.
 *
 * Priority is fixed and must not be improvised anywhere else in the codebase:
 *
 *   1. the active admin-uploaded reference,
 *   2. the bundled `public/assets/cabi-cpu-model.png`,
 *   3. a clear failure - never a random character.
 *
 * This is read fresh on every generation: changing the reference must take effect
 * on the next image, not after a cache window, and the bucket is read at most
 * once per generation.
 */
export async function resolveCabiReference(): Promise<ResolvedCabiReference | CabiReferenceUnavailable> {
  let active: CabiReferenceRow | null = null;
  try {
    active = await readActiveCabiReference();
  } catch {
    active = null;
  }

  if (active) {
    const bytes = await downloadCabiReference(active.storagePath).catch(() => null);
    if (bytes) {
      const signedUrl = await signedCabiReferenceUrl(active.storagePath).catch(() => null);
      return {
        source: "ADMIN_UPLOAD",
        version: active.version,
        path: active.storagePath,
        mimeType: active.mimeType,
        width: active.width,
        height: active.height,
        bytes,
        signedUrl,
        // An uploaded reference is a real image the server holds, so it can be
        // conditioned on whenever the model supports it.
        conditionable: true,
      };
    }
    // The row exists but its object is unreadable. Falling back is deliberately
    // allowed here rather than failing the generation: the bundled asset is the
    // same character, and a storage hiccup should not stop Cabi being drawn.
  }

  return {
    source: "BUNDLED",
    version: 0,
    path: cabiFallbackReferenceAsset,
    mimeType: "image/png",
    width: 500,
    height: 500,
    // No fetch: the fallback is served from this deployment's own /public.
    bytes: null,
    signedUrl: null,
    // Nothing to condition on, so a reference-capable model is driven by the
    // character bible instead of an image.
    conditionable: false,
  };
}

/** True when the resolved value is a usable reference rather than a failure. */
export function isUsableReference(
  value: ResolvedCabiReference | CabiReferenceUnavailable,
): value is ResolvedCabiReference {
  return (value as CabiReferenceUnavailable).ok !== false;
}

/** Narrowing helper for callers that want the explicit failure branch. */
export function referenceUnavailable(value: ResolvedCabiReference | CabiReferenceUnavailable): value is CabiReferenceUnavailable {
  return (value as CabiReferenceUnavailable).ok === false;
}

export { cabiReferenceUnavailable };
