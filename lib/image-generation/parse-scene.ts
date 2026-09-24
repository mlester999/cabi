/**
 * Parses a scene request into the parts the image pipeline can vary.
 *
 * The pipeline separates IDENTITY (fixed) from EXPRESSION, OUTFIT, and SCENE
 * (variable). This module is what turns "make another one but smiling, in a black
 * hoodie, at night" into exactly those three variables, so the identity layers are
 * never touched by a follow-up.
 *
 * The generated scene text stays explicit about what the model must HOLD: a
 * follow-up has to carry the previous scene forward, which is what makes "now put
 * yourself in a hoodie" produce the same picture with one thing changed rather
 * than a brand-new one.
 *
 * Safe on the server only in the sense that a client cannot influence identity
 * with it: every field is a value from a closed set or a sanitised scene string.
 */

import {
  cabiExpressions,
  cleanCabiScene,
  isCabiExpression,
  isCabiOutfit,
  type CabiExpression,
  type CabiOutfit,
} from "@/lib/cabi/image-identity";

/** Words that select an expression. Values must be entries in `cabiExpressions`. */
const expressionTerms: ReadonlyArray<{ expression: CabiExpression; patterns: readonly RegExp[] }> = [
  { expression: "smiling", patterns: [/\bsmil(?:e|ing)\b/iu, /\bgrinning\b/iu] },
  { expression: "laughing", patterns: [/\blaugh(?:ing|s)?\b/iu, /\bgiggling\b/iu] },
  { expression: "happy", patterns: [/\bhappy\b/iu, /\bcheerful\b/iu, /\bjoyful\b/iu] },
  { expression: "sad", patterns: [/\bsad\b/iu, /\bcrying\b/iu, /\btearful\b/iu, /\bupset\b/iu] },
  { expression: "sleepy", patterns: [/\bsleepy\b/iu, /\btired\b/iu, /\bdrowsy\b/iu, /\byawning\b/iu] },
  { expression: "curious", patterns: [/\bcurious\b/iu, /\bintrigued\b/iu, /\bwondering\b/iu] },
  { expression: "excited", patterns: [/\bexcited\b/iu, /\bthrilled\b/iu, /\bhyped\b/iu] },
  { expression: "surprised", patterns: [/\bsurprised\b/iu, /\bshocked\b/iu, /\bastonished\b/iu] },
  { expression: "focused", patterns: [/\bfocused\b/iu, /\bserious\b/iu, /\bdetermined\b/iu] },
  { expression: "annoyed", patterns: [/\bannoyed\b/iu, /\bgrumpy\b/iu, /\bpouting\b/iu, /\bangry\b/iu] },
  { expression: "shy", patterns: [/\bshy\b/iu, /\bbashful\b/iu, /\bblushing\b/iu] },
  { expression: "calm", patterns: [/\bcalm\b/iu, /\brelaxed\b/iu, /\bpeaceful\b/iu, /\bserene\b/iu] },
  { expression: "neutral", patterns: [/\bneutral\b/iu, /\bplain expression\b/iu] },
];

/** Words that select an outfit. Phrases are checked longest-first. */
const outfitTerms: ReadonlyArray<{ outfit: CabiOutfit; patterns: readonly RegExp[] }> = [
  { outfit: "pajamas", patterns: [/\bpajamas?\b/iu, /\bpyjamas?\b/iu, /\bnightwear\b/iu] },
  { outfit: "formal", patterns: [/\bformal\b/iu, /\bevening gown\b/iu, /\bdress\b/iu, /\bsuit\b/iu] },
  { outfit: "winter", patterns: [/\bwinter\b/iu, /\bcoat\b/iu, /\bscarf\b/iu, /\bsnow(?:y)?\s+(?:outfit|clothes)\b/iu] },
  { outfit: "beach", patterns: [/\bbeach\s+(?:outfit|wear|clothes)\b/iu, /\bswim(?:suit|wear)\b/iu, /\bsummer\s+outfit\b/iu] },
  { outfit: "streetwear", patterns: [/\bstreet\s?wear\b/iu, /\bcargo\b/iu, /\bsneakers?\b/iu] },
  { outfit: "gaming", patterns: [/\bgaming\s+(?:outfit|gear|setup)\b/iu, /\bheadset\b/iu] },
  { outfit: "hoodie", patterns: [/\bhoodie\b/iu, /\bhoody\b/iu, /\bsweatshirt\b/iu] },
  { outfit: "CPU shirt", patterns: [/\bcpu\s+(?:shirt|tee|t-shirt)\b/iu, /\bcpu[- ]branded\b/iu] },
  { outfit: "casual", patterns: [/\bcasual\b/iu, /\beveryday clothes\b/iu, /\bjeans\b/iu] },
];

/** Scene modifiers that describe the environment rather than the character. */
const sceneModifierTerms: readonly RegExp[] = [
  /\bat night\b/iu,
  /\bat sunset\b/iu,
  /\bat sunrise\b/iu,
  /\bin the rain\b/iu,
  /\bin the snow\b/iu,
  /\bin space\b/iu,
  /\bunderwater\b/iu,
  /\bin a forest\b/iu,
  /\bon a beach\b/iu,
  /\bin a city\b/iu,
  /\bin a cafe\b/iu,
  /\bat home\b/iu,
  /\bin a gaming room\b/iu,
  /\bin a bedroom\b/iu,
  /\bin a library\b/iu,
  /\bon a rooftop\b/iu,
  /\bin a garden\b/iu,
  /\bautumn\b/iu,
  /\bwinter\b/iu,
  /\bspring\b/iu,
  /\bsummer\b/iu,
];

/**
 * Colour words that describe clothing rather than hair or eyes.
 *
 * A colour alone ("make the outfit black") is an outfit note. The identity guard
 * in `sanitizeScene` is what stops "make her hair blonde" from being read as an
 * outfit, because that phrasing never reaches this list.
 */
const colourPattern = /\b(black|white|red|blue|green|pink|purple|violet|lavender|brown|grey|gray|beige|navy|teal|gold|silver|maroon|cream)\b/iu;

/**
 * Phrases that explicitly scope a change to the outfit.
 *
 * This is what makes "make the outfit black" an outfit note while "make her hair
 * blonde" is not: the identity guard removes the hair phrasing before it can be
 * read as clothing.
 */
const outfitScopePattern = /\b(?:outfit|clothes|clothing|wearing|wear|dress|shirt|hoodie|jacket|jeans|shoes|sneakers)\b/iu;

/** Phrases that mark a request as a modification of the current image. */
/**
 * Words that mark a message as changing the picture already on screen.
 *
 * "make" is included because "make the outfit black" edits the current image: with
 * no previous image in the conversation there is nothing to carry forward, so the
 * flag is only ever consulted alongside `previousExists`. "Cabi studying in a
 * library" is deliberately not a modification, because it is a new scene.
 */
const modificationPattern = /\b(?:another|one more|again|but|now|instead|change|adjust|modify|update|same|make|do it|try it)\b/iu;

export type CabiSceneRequest = {
  /** The scene to draw. */
  scene: string;
  /** Additional environment context carried from the previous image. */
  sceneNote: string | null;
  /** Extra outfit detail, e.g. "black". */
  outfitNote: string | null;
  expression: CabiExpression | null;
  outfit: CabiOutfit | null;
  /** True when this read as a modification rather than a fresh request. */
  isModification: boolean;
};

/**
 * Parses a request.
 *
 * `previous` is the scene of the image being modified, when there is one. A
 * modification with no previous scene keeps its own text as the scene; the
 * identity layers apply either way.
 */
export function parseCabiSceneRequest(
  message: string,
  previous?: { scene?: string | null; expression?: string | null; outfit?: string | null } | null,
): CabiSceneRequest {
  // The colour and outfit are read from the ORIGINAL message, before the scene is
  // sanitised, because the identity guard removes some of the same phrasing.
  const raw = message.trim();
  const expression = expressionTerms.find((term) => term.patterns.some((pattern) => pattern.test(raw)))?.expression ?? null;
  const outfit = outfitTerms.find((term) => term.patterns.some((pattern) => pattern.test(raw)))?.outfit ?? null;

  /*
   * Is this a change to the picture that already exists?
   *
   * Any previous image in the conversation is context, so the point of the check
   * is not "is there something to refer to" but "does this message read as
   * referring to it". "Make another one but smiling" and "now put yourself in a
   * hoodie" both do; "Cabi studying in a library" does not.
   */
  const previousExists = Boolean(previous && (previous.scene || previous.expression || previous.outfit));
  const isModification = previousExists && modificationPattern.test(raw);

  // Environment modifiers are appended so they refine a carried-forward scene
  // instead of replacing it.
  const modifiers = sceneModifierTerms.filter((pattern) => pattern.test(raw)).map((pattern) => (pattern.exec(raw)?.[0] ?? "").toLowerCase());
  const sceneNote = modifiers.length > 0 ? [...new Set(modifiers)].join(", ") : null;

  // A bare colour aimed at clothing is an outfit note. The identity guard removes
  // hair and eye colour phrasing before this point, so a colour that survives is
  // about what she is wearing.
  const colour = colourPattern.exec(raw)?.[0]?.toLowerCase() ?? null;
  const outfitNote = colour && outfitScopePattern.test(raw) ? `${colour} colourway` : null;

  const previousExpression = isCabiExpression(previous?.expression) ? previous.expression : null;
  const previousOutfit = isCabiOutfit(previous?.outfit) ? previous.outfit : null;

  const carriedScene = isModification ? cleanCabiScene(previous?.scene ?? "") : "";
  // A bare colour survives sanitisation only if it was scoped to clothing, which
  // is decided against the original message above.
  const ownScene = cleanCabiScene(raw);

  return {
    scene: carriedScene || ownScene,
    sceneNote,
    outfitNote,
    // A follow-up that only changes the expression keeps the previous outfit, and
    // vice versa. That is what makes "same but smiling" actually the same picture.
    expression: expression ?? (isModification ? previousExpression : null),
    outfit: outfit ?? (isModification ? previousOutfit : null),
    isModification,
  };
}

/** The expression catalogue, for admin copy and tests. */
export function cabiExpressionCatalogue(): readonly CabiExpression[] {
  return cabiExpressions;
}
