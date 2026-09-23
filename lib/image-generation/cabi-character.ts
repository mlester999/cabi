/**
 * Cabi character specification.
 *
 * The canonical appearance now lives in ONE place: `lib/cabi/image-identity.ts`.
 * This module re-exports it under the names the image pipeline already uses, so
 * there is a single source of truth and no second copy to drift out of sync.
 *
 * Server-only in effect: this text is never returned to a client and never
 * stored on a generation row.
 */

import { cabiImageIdentity, buildCabiImagePrompt, cabiReferenceAsset, sanitizeScene } from "@/lib/cabi/image-identity";

/** @deprecated Use `cabiImageIdentity` from `@/lib/cabi/image-identity`. */
export const cabiCharacterBible = cabiImageIdentity;

export { buildCabiImagePrompt, cabiReferenceAsset, sanitizeScene };

/** Negative guidance for providers that accept it. */
export const cabiNegativePrompt = cabiImageIdentity.negative;