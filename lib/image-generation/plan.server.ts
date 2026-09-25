import "server-only";

import {
  type CabiExpression,
  type CabiCompositionType,
  type CabiOutfit,
  buildCabiMinimalPrompt,
  buildCabiPromptLayers,
  cabiNegativePromptForScene,
  isCabiRelationshipScene,
} from "@/lib/cabi/image-identity";
import { cabiIdentityLayers, readCabiCharacterBible } from "@/lib/cabi/character-bible.server";
import { resolveCabiReference } from "@/lib/cabi/reference/resolve.server";
import { cabiReferenceUnavailable, type ResolvedCabiReference } from "@/lib/cabi/reference/types";
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
    compositionType: CabiCompositionType;
    composition: string;
    quality: string;
    identityContinuity: string;
  };
  /** The assembled prompt. Server-only; never returned to a browser. */
  prompt: string;
  /** Positive-only prompt used for the single controlled safety retry. */
  minimalPrompt: string;
  negative: string;
  /** Safe admin diagnostics describing the prompt controls applied. */
  identityLockApplied: true;
  normalizedPromptApplied: true;
  compositionType: CabiCompositionType;
  referenceActive: boolean;
  modelReferenceSupport: boolean;
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
 * Together's reference-image endpoints fetch a URL on the provider side. Only a
 * fresh HTTPS signed URL for an active admin upload is valid here. The bundled
 * local asset remains the identity fallback in the prompt, but it is not sent as
 * a provider reference because localhost/deployment-private URLs are not
 * guaranteed to be reachable by Together.
 */
export function referenceImageFor(reference: ResolvedCabiReference, modelSupportsReferenceImages: boolean): string[] | undefined {
  if (!modelSupportsReferenceImages || !reference.conditionable || !reference.signedUrl) return undefined;
  try {
    const url = new URL(reference.signedUrl);
    // Never hand Together a data URL, localhost URL, or plain HTTP URL. The
    // adapter performs the same validation as a final defense-in-depth check.
    if (url.protocol !== "https:") return undefined;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) return undefined;
    return [url.toString()];
  } catch {
    return undefined;
  }
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

  const parts = buildCabiPromptLayers({
    scene: input.scene,
    expression: input.expression ?? null,
    outfit: input.outfit ?? null,
    outfitNote: input.outfitNote ?? null,
    sceneNote: input.sceneNote ?? null,
  });
  const layers = cabiIdentityLayers({ artDirection: bible.artDirection, composition: parts.composition });

  // Owner art direction augments the request-specific composition; identity and
  // quality remain fixed.
  const prompt = [
    parts.identity,
    parts.expression ? `Expression: ${parts.expression}.` : null,
    parts.outfit ? `Outfit: ${parts.outfit}.` : null,
    `Scene: ${parts.scene}.`,
    layers.composition,
    parts.quality,
    parts.identityContinuity,
  ].filter((part): part is string => Boolean(part)).join(" ");

  const minimalPrompt = buildCabiMinimalPrompt({
    scene: parts.scene,
    expression: input.expression ?? null,
    outfit: input.outfit ?? null,
    outfitNote: input.outfitNote ?? null,
    sceneNote: input.sceneNote ?? null,
  });

  const referenceImages = referenceImageFor(reference, input.modelSupportsReferenceImages);
  return {
    ok: true,
    plan: {
      parts: { ...parts, composition: layers.composition },
      prompt,
      minimalPrompt,
      negative: isCabiRelationshipScene(parts.scene)
        ? ""
        : [cabiNegativePromptForScene(parts.scene), bible.negative].filter(Boolean).join(", "),
      identityLockApplied: true,
      normalizedPromptApplied: true,
      compositionType: parts.compositionType,
      referenceActive: reference.source === "ADMIN_UPLOAD",
      modelReferenceSupport: input.modelSupportsReferenceImages,
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
      // Together receives a signed HTTPS URL, never a data URL or local path.
      referenceBytes: null,
      referenceImages,
      capabilities: { referenceConditioning: Boolean(referenceImages?.length) },
    },
  };
}

/** The drift targets, for the admin console's character-bible section. */
export { cabiProhibitedDrift as cabiProtectedIdentityTraits } from "@/lib/cabi/image-identity";
