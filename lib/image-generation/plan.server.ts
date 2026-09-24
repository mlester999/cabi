import "server-only";

import { publicAppUrl } from "@/lib/config/env";
import {
  type CabiExpression,
  type CabiOutfit,
  buildCabiPromptLayers,
  cabiNegativePrompt,
} from "@/lib/cabi/image-identity";
import { cabiIdentityLayers, readCabiCharacterBible } from "@/lib/cabi/character-bible.server";
import { resolveCabiReference } from "@/lib/cabi/reference/resolve.server";
import { cabiFallbackReferenceAsset, cabiReferenceUnavailable, type ResolvedCabiReference } from "@/lib/cabi/reference/types";
import type { AspectRatio } from "@/lib/image-generation/types";

/**
 * The generation plan.
 *
 * This is where the character bible, the official reference, and the user's scene
 * meet, so that no route has to assemble a prompt itself. Two rules hold here:
 *
 * 1. IDENTITY comes from the bible, never from the request. Expression and outfit
 *    are typed values from a closed set, and the scene is sanitised — so a request
 *    can change how Cabi looks in the picture but not who she is.
 * 2. The reference is resolved fresh from the single official source. A user
 *    cannot supply, replace, or override the reference used for their generation.
 */

export type CabiGenerationPlan = {
  /** Every prompt layer, kept separate so a change to one is provably isolated. */
  parts: {
    identity: string;
    expression: string | null;
    outfit: string | null;
    scene: string;
    composition: string;
    quality: string;
  };
  /** The assembled prompt. Server-only; never returned to a browser. */
  prompt: string;
  negative: string;
  expression: CabiExpression | null;
  outfit: CabiOutfit | null;
  scene: string;
  aspectRatio: AspectRatio;
  seed: number | null;
  /** Which official reference this generation will use. */
  reference: {
    source: ResolvedCabiReference["source"];
    version: number;
    path: string;
    width: number | null;
    height: number | null;
  };
  /**
   * The reference bytes, present only when they can actually reach the model.
   * Null is the honest answer for a model without reference conditioning.
   */
  referenceBytes: Uint8Array | null;
  /** Present only when reference conditioning is available. */
  referenceImages: string[] | undefined;
  /** What was asked of the provider, recorded for the admin view. */
  capabilities: { referenceConditioning: boolean };
};

export type CabiGenerationPlanResult =
  | { ok: true; plan: CabiGenerationPlan }
  | { ok: false; reason: "NO_REFERENCE"; message: string };

/**
 * The server-controlled image reference for the selected model.
 *
 * A data URL is used for an uploaded reference so the provider does not need a
 * reachable signed URL, and the bundled asset is served from this deployment's own
 * origin. `data:` URLs are only ever built from bytes this server produced.
 */
export function referenceImageFor(reference: ResolvedCabiReference, modelSupportsReferenceImages: boolean): string[] | undefined {
  if (!modelSupportsReferenceImages) return undefined;

  if (reference.bytes && reference.bytes.byteLength > 0) {
    // btoa is unavailable for arbitrary byte strings in every runtime, so the
    // conversion is done explicitly rather than with a shortcut.
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < reference.bytes.byteLength; offset += chunk) {
      binary += String.fromCharCode(...reference.bytes.subarray(offset, offset + chunk));
    }
    return [`data:${reference.mimeType};base64,${btoa(binary)}`];
  }

  if (reference.source === "BUNDLED") {
    // The bundled reference lives at a fixed /public path on this deployment.
    return [`${publicAppUrl().replace(/\/$/u, "")}${cabiFallbackReferenceAsset}`];
  }

  // An uploaded reference whose bytes could not be read still has a signed URL.
  return reference.signedUrl ? [reference.signedUrl] : undefined;
}

/**
 * Builds everything a generation needs.
 *
 * `modelSupportsReferenceImages` comes from the provider's capability record, which
 * is derived from the selected model. When it is false the reference images are
 * omitted entirely rather than sent and ignored: an unsupported parameter is not
 * silently forwarded.
 */
export async function buildCabiGenerationPlan(input: {
  scene: string;
  aspectRatio: AspectRatio;
  expression?: CabiExpression | null;
  outfit?: CabiOutfit | null;
  outfitNote?: string | null;
  sceneNote?: string | null;
  seed?: number | null;
  modelSupportsReferenceImages: boolean;
}): Promise<CabiGenerationPlanResult> {
  const [bible, reference] = await Promise.all([readCabiCharacterBible(), resolveCabiReference()]);
  if (!("source" in reference)) {
    const unavailable = cabiReferenceUnavailable();
    return { ok: false, reason: unavailable.reason, message: unavailable.message };
  }

  const layers = cabiIdentityLayers({ artDirection: bible.artDirection });
  const parts = buildCabiPromptLayers({
    scene: input.scene,
    expression: input.expression ?? null,
    outfit: input.outfit ?? null,
    outfitNote: input.outfitNote ?? null,
    sceneNote: input.sceneNote ?? null,
  });

  // The owner's art direction replaces the shipped composition text only when it
  // is set; identity and quality are never owner-editable.
  const prompt = [
    parts.identity,
    parts.expression ? `Expression: ${parts.expression}.` : null,
    parts.outfit ? `Outfit: ${parts.outfit}.` : null,
    `Scene: ${parts.scene}.`,
    layers.composition,
    parts.quality,
  ].filter((part): part is string => Boolean(part)).join(" ");

  const referenceImages = referenceImageFor(reference, input.modelSupportsReferenceImages);
  return {
    ok: true,
    plan: {
      parts: { ...parts, composition: layers.composition },
      prompt,
      negative: bible.negative || cabiNegativePrompt,
      expression: input.expression ?? null,
      outfit: input.outfit ?? null,
      scene: parts.scene,
      aspectRatio: input.aspectRatio,
      seed: typeof input.seed === "number" && Number.isSafeInteger(input.seed) ? input.seed : null,
      reference: {
        source: reference.source,
        version: reference.version,
        path: reference.path,
        width: reference.width,
        height: reference.height,
      },
      // The bytes only travel when they can actually be used.
      referenceBytes: input.modelSupportsReferenceImages && reference.bytes ? reference.bytes : null,
      referenceImages,
      capabilities: { referenceConditioning: Boolean(referenceImages?.length) },
    },
  };
}

/** The drift targets, for the admin console's character-bible section. */
export { cabiProhibitedDrift as cabiProtectedIdentityTraits } from "@/lib/cabi/image-identity";
