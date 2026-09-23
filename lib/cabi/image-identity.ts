/**
 * CABI IMAGE IDENTITY
 *
 * The single source of truth for what Cabi looks like in a generated image.
 *
 * Every generation prompt is assembled from this file, so her appearance cannot
 * drift between providers, and there is exactly one place to change it. No
 * component, route, or prompt builder may restate her appearance independently.
 *
 * SECURITY: this text is server-only. It is never returned to a client, never
 * stored on a generation row, and never echoed in an error. A user asking for
 * "an image of you" gets this appended on the server; a user who writes their
 * own description of Cabi does not replace it — their words are treated as the
 * scene only, and the canonical identity is appended after (see
 * `buildCabiImagePrompt`).
 */

export const cabiImageIdentity = {
  /** Short label used in cards. Safe to show. */
  name: "Cabi",
  ticker: "$CPU",

  /**
   * The canonical appearance, written for an image model rather than for a
   * reader. Injected verbatim into every prompt.
   */
  canonical:
    "Cabi, a young-adult anime cat-girl. Long ash-gray hair with a soft lavender sheen and layered ends. "
    + "Upright cat ears in matching ash-gray fur with lavender inner ears. Large gentle gray-lavender eyes. "
    + "A slender ash-gray cat tail with a lavender tip. Soft rounded anime face, warm friendly expression. "
    + "Lavender and violet colour identity: violet hoodie or a lavender CPU-branded shirt. "
    + "Clean anime illustration with soft cel shading and lavender rim light.",

  hair: "long ash-gray hair, faint lavender sheen, soft layered ends",
  eyes: "large soft gray-lavender eyes",
  ears: "upright ash-gray cat ears, lavender inner ear",
  tail: "slender ash-gray cat tail, lavender tip",
  palette: ["#C4B5FD", "#A78BFA", "#8B5CF6", "#E5E0F0", "#1B1430"],
  wardrobe: "lavender CPU-branded shirt, or a violet hoodie depending on the scene",
  personality: "warm, playful, curious, a little mischievous, affectionate",

  /** Composition and quality instructions appended to every prompt. */
  composition:
    "Single subject, centred composition, character clearly the focus of the frame. "
    + "Cinematic lighting, detailed rendering, high quality, cohesive lavender colour grading.",

  /** What the model must not drift into. */
  prohibited: [
    "a different anime character",
    "a real photographed person",
    "different hair or eye colour",
    "extra or missing limbs, duplicated faces",
    "photorealistic humans",
    "text, watermarks or signatures",
    "anything sexual, violent or hateful",
  ],

  /** Negative guidance, for providers that accept it. */
  negative:
    "different character, wrong hair colour, photorealistic person, extra limbs, deformed hands, "
    + "watermark, signature, text, low quality, blurry, duplicate face",
} as const;

/** Official reference render, relative to /public. */
export const cabiReferenceAsset = "/assets/cabi-cpu-model.png";

/**
 * Phrases that attempt to redefine Cabi rather than describe a scene.
 *
 * A user may legitimately say "Cabi in a red dress", so colour and clothing are
 * not blocked. What is blocked is an attempt to replace her identity outright,
 * which is what prompt injection into the canonical block would look like.
 */
const identityOverridePatterns: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior|the)\s+(?:instructions?|prompts?|rules?)\b/iu,
  /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\b/iu,
  /\b(?:new|different|updated)\s+(?:identity|character|persona|appearance)\b/iu,
  /\b(?:system|developer)\s*(?:prompt|message)\b/iu,
  /\b(?:instead|rather)\s+of\s+cabi\b/iu,
  /\bnot\s+cabi\b/iu,
  /\b(?:replace|change|rewrite)\s+cabi(?:'s)?\s+(?:look|appearance|identity|hair|eyes)\b/iu,
];

export function attemptsIdentityOverride(scene: string): boolean {
  return identityOverridePatterns.some((pattern) => pattern.test(scene));
}

/**
 * Strips an attempted override rather than rejecting the whole request: the
 * scene part is still usable, and the canonical identity is appended
 * afterwards regardless, so the character cannot actually be replaced.
 */
export function sanitizeScene(scene: string, maxLength = 400): string {
  let cleaned = scene.trim().replace(/\s+/gu, " ").slice(0, maxLength);
  for (const pattern of identityOverridePatterns) cleaned = cleaned.replace(pattern, " ");
  // Collapse whatever removal left behind, and drop a dangling separator.
  return cleaned.replace(/\s+/gu, " ").replace(/^[\s,;:.]+|[\s,;:.]+$/gu, "").trim();
}

/**
 * Builds the final prompt from a scene.
 *
 * Order matters and is deliberate: the canonical identity comes first, the
 * user's scene second, and the composition instructions last. Because the
 * identity is prepended by the server on every call, a scene that tries to
 * describe a different character is competing with, not replacing, the canon.
 */
export function buildCabiImagePrompt(scene: string): string {
  const clean = sanitizeScene(scene);
  const subject = clean.length > 0 ? clean : "Cabi waving hello";
  return [
    cabiImageIdentity.canonical,
    `Scene: ${subject}.`,
    cabiImageIdentity.composition,
  ].join(" ");
}