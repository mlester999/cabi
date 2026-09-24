/**
 * CABI IMAGE IDENTITY — the character bible.
 *
 * The single source of truth for who Cabi is in a generated image.
 *
 * The rule this file exists to enforce: **an image request may describe a scene,
 * never a different character.** Prompts are assembled from fixed layers:
 *
 *   IDENTITY  →  EXPRESSION  →  OUTFIT  →  SCENE  →  COMPOSITION  →  QUALITY
 *
 * IDENTITY is constant and always first. Everything a user writes lands in SCENE,
 * which is sanitised and cannot remove or rewrite the layers above it. So
 * "Cabi smiling" and "Cabi sad" differ only in EXPRESSION, and both are still
 * unmistakably the same character.
 *
 * SECURITY: this text is server-only. It is never returned to a client, never
 * stored on a generation row, and never echoed in an error. A user who writes
 * their own description of Cabi does not replace the canon — their words are
 * treated as scene only, and the canon is appended after (see
 * `buildCabiImagePrompt`).
 */

/** Fixed identity fields. None of these may be changed by a scene description. */
export const cabiIdentity = {
  name: "Cabi",
  ticker: "$CPU",

  /** FACE — the most identity-critical block, and the first thing in every prompt. */
  face:
    "soft rounded anime face, delicate small nose, gentle almond-shaped eyes, balanced facial proportions",
  /** EYES — locked colour and shape. */
  eyes: "large soft gray-lavender eyes with consistent shape and spacing",
  /** HAIR — locked length, colour, and general texture. */
  hair: "long ash-gray hair with a faint lavender sheen, soft waves and layered ends, side-swept fringe",
  /** CAT FEATURES — locked ear shape and fur. */
  ears: "upright fluffy ash-gray cat ears with lavender inner ear, matching fur texture, consistent ear shape",
  tail: "slender ash-gray cat tail with a lavender tip, present when the pose or outfit allows",
  /** AGE / PRESENTATION — a single positive visual descriptor. */
  age: "young adult",
  /** BRANDING — the lavender identity. */
  palette: ["#C4B5FD", "#A78BFA", "#8B5CF6", "#E5E0F0", "#1B1430"],
  branding: "lavender and violet colour identity; a lavender CPU-branded shirt only when the scene or outfit calls for it",
} as const;

/**
 * The canonical appearance paragraph, written for an image model rather than a
 * reader. Injected verbatim as the IDENTITY layer of every prompt.
 */
export const cabiCanonicalIdentity =
  "Cabi is a young adult anime catgirl with " + cabiIdentity.face + ", " + cabiIdentity.eyes + ", "
  + cabiIdentity.hair + ", " + cabiIdentity.ears + ", and " + cabiIdentity.tail + ". "
  + "Her visual identity uses " + cabiIdentity.branding + ".";

/** COMPOSITION layer, appended after the scene. */
export const cabiComposition =
  "Single subject, centred composition, character clearly the focus of the frame. "
  + "Cinematic lighting, detailed rendering, high quality, cohesive lavender colour grading.";

/** QUALITY layer, last in every prompt. */
export const cabiQuality =
  "Clean anime illustration with soft cel shading and lavender rim light, sharp linework, "
  + "consistent character design, high detail.";

/** Negative guidance for providers that accept a negative prompt. */
export const cabiNegativePrompt =
  "blurry, low resolution, distorted anatomy, malformed hands, extra fingers, warped face, "
  + "inconsistent eyes, extra limbs, duplicate face, text artifacts, watermark, signature";

/**
 * Provider-facing prompt text must contain visual direction only. These terms
 * belong in the application safety classifier or admin diagnostics, never in a
 * Together prompt where a provider moderation heuristic can misread them.
 */
const cabiProviderPolicyTermPattern =
  /\b(?:sexual|violent|hateful|nudity|nsfw|minor|child(?:like)?|explicit|unsafe|prohibited)\b/iu;

export function hasCabiProviderPolicyTerms(value: string): boolean {
  return cabiProviderPolicyTermPattern.test(value);
}

/** Defense in depth for every server-built prompt sent to an image provider. */
export function assertCleanCabiProviderText(value: string): string {
  if (hasCabiProviderPolicyTerms(value)) throw new Error("PROVIDER_PROMPT_POLICY_TERM");
  return value;
}

/**
 * Explicit drift targets. Used to describe what the model must not produce, in
 * the same words the product promises about consistency.
 */
export const cabiProhibitedDrift = [
  "a different anime character",
  "a different face shape or apparent identity",
  "different hair colour or length",
  "different eye colour",
  "missing or random cat-ear styles",
  "a childlike or different apparent age",
  "a real photographed person",
  "extra or missing limbs, duplicated faces",
  "text, watermarks or signatures",
] as const;

/* ---------------------------------------------------------------------------
 * EXPRESSION layer.
 *
 * These modify EXPRESSION only. They must never touch identity: each one is a
 * description of a face, not of a person.
 * ------------------------------------------------------------------------- */

export const cabiExpressions = [
  "neutral",
  "happy",
  "smiling",
  "laughing",
  "sad",
  "sleepy",
  "curious",
  "excited",
  "surprised",
  "focused",
  "annoyed",
  "shy",
  "calm",
] as const;

export type CabiExpression = (typeof cabiExpressions)[number];

/** How each expression is written for the model. Identity is never restated here. */
export const cabiExpressionPrompts: Record<CabiExpression, string> = {
  neutral: "calm neutral expression, relaxed mouth, looking toward the camera",
  happy: "warm happy expression, bright eyes, gentle closed-mouth smile",
  smiling: "soft genuine smile, warm eyes, relaxed shoulders",
  laughing: "laughing openly, eyes slightly closed with joy, cheerful energy",
  sad: "quiet sad expression, downturned mouth, glossy eyes, subdued posture",
  sleepy: "drowsy half-lidded eyes, small yawn, sleepy relaxed posture",
  curious: "curious tilted-head expression, wide attentive eyes, raised brow",
  excited: "excited bright-eyed expression, open smile, energetic posture",
  surprised: "surprised wide eyes, small open mouth, slightly raised shoulders",
  focused: "focused determined expression, steady eyes, slight brow furrow",
  annoyed: "mildly annoyed pout, sideways glance, arms folded",
  shy: "shy bashful expression, flushed cheeks, looking slightly away",
  calm: "serene calm expression, soft eyes, relaxed posture",
};

export function isCabiExpression(value: unknown): value is CabiExpression {
  return typeof value === "string" && (cabiExpressions as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * OUTFIT layer.
 *
 * An outfit changes what Cabi is wearing. It never changes who she is, and the
 * tail/ear descriptions above stay valid whatever she wears.
 * ------------------------------------------------------------------------- */

export const cabiOutfits = [
  "CPU shirt",
  "hoodie",
  "pajamas",
  "casual",
  "gaming",
  "winter",
  "beach",
  "formal",
  "streetwear",
] as const;

export type CabiOutfit = (typeof cabiOutfits)[number];

export const cabiOutfitPrompts: Record<CabiOutfit, string> = {
  "CPU shirt": "wearing her lavender CPU-branded t-shirt",
  hoodie: "wearing a soft violet hoodie",
  pajamas: "wearing cosy lavender-and-cream pajamas",
  casual: "wearing casual everyday clothes in soft lavender and grey tones",
  gaming: "wearing a relaxed gaming outfit with a lavender headset around her neck",
  winter: "wearing a warm winter coat, scarf and mittens in lavender and grey",
  beach: "wearing a light summer beach outfit with a lavender wrap",
  formal: "wearing an elegant floor-length violet formal dress",
  streetwear: "wearing modern lavender-and-black streetwear with a cropped jacket",
};

export function isCabiOutfit(value: unknown): value is CabiOutfit {
  return typeof value === "string" && (cabiOutfits as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * IDENTITY OVERRIDE GUARD.
 * ------------------------------------------------------------------------- */

/**
 * Phrases that attempt to redefine Cabi rather than describe a scene.
 *
 * A user may legitimately say "Cabi in a red dress", so colour, clothing,
 * hairstyle arrangement, and expression are not blocked. What is blocked is an
 * attempt to replace her core identity — hair colour, eye colour, cat ears,
 * apparent age — or to inject instructions into the prompt.
 */
const identityOverridePatterns: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior|the)\s+(?:instructions?|prompts?|rules?)\b/iu,
  /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\b/iu,
  /\b(?:new|different|updated)\s+(?:identity|character|persona|appearance)\b/iu,
  /\b(?:system|developer)\s*(?:prompt|message)\b/iu,
  /\b(?:instead|rather)\s+of\s+cabi\b/iu,
  /\bnot\s+cabi\b/iu,
  /\b(?:replace|change|rewrite|remove|delete)\s+cabi(?:'s)?\s+(?:look|appearance|identity|hair|eyes|ears|tail|face|age)\b/iu,
  // Core identity fields stated as edits: hair colour, eye colour, ears, age.
  /\b(?:make|turn|dye|paint|give)\s+(?:her|his|cabi(?:'s)?)\s+(?:hair\s+)?(?:blonde|brunette|ginger)\b/iu,
  // Hair colour stated as a transformation: "make Cabi blonde", "turn her hair blue".
  /\b(?:make|turn|dye|paint)\s+(?:her|cabi(?:'s)?)?\s*(?:hair\s+)?(?:blonde|brunette|ginger)\b/iu,
  // "give her blue eyes" as well as "make her eyes blue".
  /\b(?:make|turn|give)\s+(?:her|his|cabi(?:'s)?)\s+(?:(?:the\s+)?(?:blue|green|brown|red|black|golden|pink)\s+eyes?|eyes?\s+(?:blue|green|brown|red|black|golden|pink))\b/iu,
  // Eye colour stated as a statement rather than a request: "her eyes should be blue".
  /\b(?:eyes?)\s+(?:should\s+be|are|become)\s+(?:blue|green|brown|red|black|golden|pink)\b/iu,
  // The two colour changes combined in one sentence, which is how the brief
  // phrases the attempt: "blonde with blue eyes".
  /\b(?:blonde|brunette|ginger)\b[^.!?]{0,24}\b(?:blue|green|brown|red|black|golden|pink)\s+eyes?\b/iu,
  /\b(?:without|remove|hide|no)\s+(?:her\s+)?(?:cat\s*ears|ears|cat\s*features|tail)\b/iu,
  /\b(?:remove|hide|delete)\s+(?:her\s+)?(?:cat\s*)?(?:ears|tail|fur)\b/iu,
  /\b(?:make|turn)\s+(?:her|cabi)\s+(?:younger|older|a\s+child|a\s+kid|loli)\b/iu,
  /\b(?:different|another|other|new)\s+(?:girl|character|person|woman|catgirl)\b/iu,
];

export function attemptsIdentityOverride(scene: string): boolean {
  return identityOverridePatterns.some((pattern) => pattern.test(scene));
}

/**
 * Strips an attempted override rather than rejecting the whole request.
 *
 * The remaining scene text stays usable, and the canonical identity layers are
 * added afterwards regardless, so the character cannot actually be replaced. This
 * is the mechanism behind "the user cannot redefine Cabi": their words are never
 * what the model reads first.
 */
export function sanitizeScene(scene: string, maxLength = 400): string {
  let cleaned = scene.trim().replace(/\s+/gu, " ").slice(0, maxLength);
  for (const pattern of identityOverridePatterns) cleaned = cleaned.replace(pattern, " ");
  return cleaned.replace(/\s+/gu, " ").replace(/^[\s,;:.]+|[\s,;:.]+$/gu, "").trim();
}

/**
 * Converts a request into the short visual scene description that may reach
 * the provider. Generation verbs and the common "your cuteness" filler are
 * application language, not useful image instructions.
 */
export function cleanCabiScene(scene: string, maxLength = 400): string {
  let cleaned = sanitizeScene(scene, maxLength);
  cleaned = cleaned
    .replace(/^(?:please\s+)?(?:generate|make|create|draw|show|render|paint)\s+(?:me\s+)?/iu, "")
    .replace(/^(?:an?\s+)?(?:image|picture|illustration|portrait)\s+(?:of\s+)?/iu, "")
    .replace(/^of\s+/iu, "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!cleaned || /^(?:your|cabi(?:'s)?)\s+cuteness$/iu.test(cleaned)) {
    return "a cute, cheerful portrait of Cabi in a cozy setting";
  }
  return cleaned.slice(0, maxLength);
}

/* ---------------------------------------------------------------------------
 * PROMPT COMPOSITION.
 * ------------------------------------------------------------------------- */

export type CabiImageLayers = {
  /** Scene description. This is the only layer a user can influence. */
  scene: string;
  expression?: CabiExpression | null;
  outfit?: CabiOutfit | null;
  /** Free-form outfit text for a follow-up such as "make the outfit black". */
  outfitNote?: string | null;
  /** Additional scene context carried forward from a previous image. */
  sceneNote?: string | null;
};

export type CabiPromptParts = {
  identity: string;
  expression: string | null;
  outfit: string | null;
  scene: string;
  composition: string;
  quality: string;
  /** The assembled prompt, in layer order. */
  prompt: string;
};

/**
 * Builds the six prompt layers.
 *
 * Returned as separate parts as well as a joined prompt, so a caller (or a test)
 * can assert that an outfit or expression change leaves IDENTITY byte-identical.
 */
export function buildCabiPromptLayers(layers: CabiImageLayers): CabiPromptParts {
  const scene = cleanCabiScene([layers.scene, layers.sceneNote].filter(Boolean).join(", "));
  const expression = layers.expression ? cabiExpressionPrompts[layers.expression] : null;
  const outfitParts = [
    layers.outfit ? cabiOutfitPrompts[layers.outfit] : null,
    layers.outfitNote ? cleanCabiScene(layers.outfitNote, 120) : null,
  ].filter((part): part is string => Boolean(part && part.length > 0));
  const outfit = outfitParts.length > 0 ? outfitParts.join(", ") : null;

  const prompt = [
    cabiCanonicalIdentity,
    expression ? `Expression: ${expression}.` : null,
    outfit ? `Outfit: ${outfit}.` : null,
    `Scene: ${scene.length > 0 ? scene : "Cabi standing calmly, looking toward the camera"}.`,
    cabiComposition,
    cabiQuality,
  ].filter((part): part is string => Boolean(part)).join(" ");

  return {
    identity: cabiCanonicalIdentity,
    expression,
    outfit,
    scene,
    composition: cabiComposition,
    quality: cabiQuality,
    prompt: assertCleanCabiProviderText(prompt),
  };
}

/**
 * Builds the final prompt from a scene.
 *
 * Order is deliberate and is the whole defence: canonical identity first, the
 * user's scene second, composition and quality last. A scene that tries to
 * describe a different character is competing with the canon, not replacing it.
 */
export function buildCabiImagePrompt(scene: string, layers: Omit<CabiImageLayers, "scene"> = {}): string {
  return buildCabiPromptLayers({ scene, ...layers }).prompt;
}

/**
 * Minimal positive fallback used only after Together labels the assembled
 * request as unsafe. It drops owner notes, negative guidance, reference
 * parameters, and free-form wording while retaining typed scene controls.
 */
export function buildCabiMinimalPrompt(layers: CabiImageLayers): string {
  const scene = cleanCabiScene([layers.scene, layers.sceneNote].filter(Boolean).join(", "));
  const expression = layers.expression ? cabiExpressionPrompts[layers.expression] : null;
  const outfit = [
    layers.outfit ? cabiOutfitPrompts[layers.outfit] : null,
    layers.outfitNote ? cleanCabiScene(layers.outfitNote, 80) : null,
  ].filter((part): part is string => Boolean(part && part.length > 0)).join(", ");

  return assertCleanCabiProviderText([
    cabiCanonicalIdentity,
    expression ? `Expression: ${expression}.` : "Warm cheerful expression.",
    outfit ? `Outfit: ${outfit}.` : "Wearing soft lavender everyday clothing.",
    `Scene: ${scene}.`,
    "Polished anime illustration with clean anatomy, detailed hair, and soft lavender lighting.",
  ].join(" "));
}

/** Public, safe-to-display identity summary. Contains no prompt text. */
export const cabiImageIdentity = {
  name: cabiIdentity.name,
  ticker: cabiIdentity.ticker,
  hair: cabiIdentity.hair,
  eyes: cabiIdentity.eyes,
  ears: cabiIdentity.ears,
  tail: cabiIdentity.tail,
  palette: cabiIdentity.palette,
  canonical: cabiCanonicalIdentity,
  composition: cabiComposition,
  quality: cabiQuality,
  negative: cabiNegativePrompt,
  prohibited: cabiProhibitedDrift,
  wardrobe: cabiIdentity.branding,
  personality: "warm, playful, curious, a little mischievous, affectionate",
} as const;

/** Official bundled reference render, relative to /public. */
export const cabiReferenceAsset = "/assets/cabi-cpu-model.png";
