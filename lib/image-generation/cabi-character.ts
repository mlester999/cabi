/**
 * CABI_CHARACTER_BIBLE
 *
 * The canonical description of what Cabi looks like. Every generated image is
 * built from this specification so she stays recognisable across generations
 * instead of drifting into a different anime character each time.
 *
 * This module is server-only in effect and is NEVER returned to a client. The
 * gallery stores the user's own words, not this text.
 *
 * Visual characteristics are taken from the supplied official reference render
 * at /public/assets/cabi-cpu-model.png. When a provider supports reference
 * images, that file is attached; when it does not, this description carries the
 * character instead. Both paths use the same specification so the two cannot
 * disagree.
 */

export const cabiCharacterBible = {
  identity: "Cabi, the Cat Partner Unit",
  /** The single paragraph injected into every generation prompt. */
  canonical:
    "Cabi, a young-adult anime cat-girl mascot. Long ash-gray hair with a soft lavender sheen, "
    + "framed by a pair of upright cat ears. Large, gentle gray-lavender eyes. A slender cat tail. "
    + "A purple and lavender colour identity: violet hoodie or the lavender CPU-branded shirt. "
    + "Warm, playful, approachable expression. Clean anime illustration style with soft cel shading, "
    + "lavender rim light, and a dark violet background palette.",
  hair: "Long ash-gray hair with a faint lavender sheen, straight with soft layered ends",
  hairColor: "ash gray / cool gray with lavender highlights",
  eyes: "large, soft gray-lavender eyes with a gentle highlight",
  ears: "upright anime cat ears, same ash-gray fur with a lavender inner ear",
  tail: "slender ash-gray cat tail with a lavender tip",
  facialFeatures: "soft rounded anime face, small nose, warm friendly mouth",
  palette: ["#C4B5FD", "#A78BFA", "#8B5CF6", "#E5E0F0", "#1B1430"],
  outfit: "lavender CPU-branded shirt, or a violet hoodie depending on the scene",
  personality: "warm, playful, curious, a little mischievous, always affectionate",
  /** Things a generator must not drift into. */
  prohibited: [
    "a different anime character",
    "a real photographed person",
    "a generic anime girl with different hair or eye colour",
    "extra or missing limbs, duplicated faces",
    "photorealistic humans",
    "text or logos other than CPU branding",
    "anything sexual, violent, or hateful",
  ],
} as const;

/** Reference file path, relative to /public. */
export const cabiReferenceAsset = "/assets/cabi-cpu-model.png";

/**
 * Negative guidance handed to providers that accept it.
 */
export const cabiNegativePrompt = [
  "different character", "photorealistic", "extra limbs", "deformed hands",
  "text", "watermark", "signature", "low quality", "blurry",
].join(", ");

/** The full positive prompt for one scene. */
export function buildCabiImagePrompt(scene: string): string {
  const trimmed = scene.trim().replace(/\s+/gu, " ").slice(0, 400);
  return `${cabiCharacterBible.canonical} Scene: ${trimmed}. Consistent character design, single subject, centered composition.`;
}