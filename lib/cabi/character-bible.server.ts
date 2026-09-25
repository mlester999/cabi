import "server-only";

import {
  cabiCanonicalIdentity,
  cabiComposition,
  cabiQuality,
  cleanCabiScene,
} from "@/lib/cabi/image-identity";
import { getServiceClient } from "@/lib/db/supabase";
import { createTtlCache } from "@/lib/wallet-data/cache";
import { z } from "zod";

/**
 * Admin-editable layer of the character bible.
 *
 * The core identity — face, hair, eyes, cat ears, age — is NOT editable. It lives
 * in `lib/cabi/image-identity.ts` as code, which is what makes "Cabi stays Cabi"
 * a property of the build rather than a setting somebody can accidentally erase.
 *
 * What an owner may edit here is the descriptive and stylistic layer around it:
 * art-direction notes and the negative guidance. Those are additive, so the
 * failure mode of a bad edit is a less pleasant image, never a different character.
 */

export const cabiCharacterBibleKey = "cabi_character_bible";

export type CabiCharacterBible = {
  /** Extra art-direction notes appended to every prompt. */
  artDirection: string;
  /** Extra negative guidance, appended after the fixed identity drift guidance. */
  negative: string;
  /** Whether the owner's values are in use. */
  customized: boolean;
};

export const cabiCharacterBibleDefaults: CabiCharacterBible = {
  artDirection: "",
  negative: "",
  customized: false,
};

export const cabiCharacterBibleSchema = z.object({
  artDirection: z.string().trim().max(600),
  negative: z.string().trim().max(600),
});

/** Owner notes are visual controls only; they are never a second prompt. */
const nonVisualGuidancePatterns: readonly RegExp[] = [
  /https?:\/\//iu,
  /\b(?:system|developer|assistant|user)\s+(?:prompt|message|instruction)s?\b/iu,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\b/iu,
  /\b(?:provider|model|endpoint|api\s*key|token|url|http|switch\s+model)\b/iu,
  /\b(?:unsafe|prohibited|sexual(?:i[sz]ed)?|violent|violence|hateful|nudity|nsfw|minors?|child(?:like)?|children|explicit(?:ly)?)\b/iu,
];

const nonQualityNegativePatterns: readonly RegExp[] = [
  /\b(?:different|wrong|missing)\s+(?:character|identity|hair|eye|eyes|cat\s*ears?|tail)\b/iu,
  /\b(?:character|identity|persona|age)\s+(?:change|drift|replacement)\b/iu,
  /\b(?:real|photographed|photorealistic)\s+person\b/iu,
];

export function sanitizeVisualGuidance(value: string, field: "artDirection" | "negative"): string {
  if (!value.trim()) return "";
  const cleaned = cleanCabiScene(value, 600);
  if (nonVisualGuidancePatterns.some((pattern) => pattern.test(value))) {
    throw new Error("VISUAL_GUIDANCE_ONLY");
  }
  // Negative guidance is intentionally a quality list, not a policy or
  // identity list. The same visual sanitizer is used for both fields so an old
  // stored value can never leak provider-control text back into a prompt.
  if (field === "negative" && /\b(?:do not|don't|never|avoid)\b/iu.test(cleaned)) {
    throw new Error("VISUAL_GUIDANCE_ONLY");
  }
  if (field === "negative" && nonQualityNegativePatterns.some((pattern) => pattern.test(cleaned))) {
    throw new Error("VISUAL_GUIDANCE_ONLY");
  }
  return cleaned;
}

export const cabiCharacterBibleTtlMs = 30_000;

const bibleCache = createTtlCache<CabiCharacterBible>(cabiCharacterBibleTtlMs, 4);

export function invalidateCabiCharacterBibleCache() {
  bibleCache.clear();
}

export function parseCabiCharacterBible(value: unknown, fallback: CabiCharacterBible = cabiCharacterBibleDefaults): CabiCharacterBible {
  const parsed = cabiCharacterBibleSchema.partial().safeParse(value ?? {});
  if (!parsed.success) return fallback;
  let artDirection = fallback.artDirection;
  let negative = fallback.negative;
  try {
    if (parsed.data.artDirection !== undefined) artDirection = sanitizeVisualGuidance(parsed.data.artDirection, "artDirection");
    if (parsed.data.negative !== undefined) negative = sanitizeVisualGuidance(parsed.data.negative, "negative");
  } catch {
    return fallback;
  }
  return { artDirection, negative, customized: artDirection.length > 0 || negative.length > 0 };
}

export async function readCabiCharacterBible(options: { fresh?: boolean } = {}): Promise<CabiCharacterBible> {
  if (!options.fresh) {
    const hit = bibleCache.get("bible");
    if (hit) return hit.value;
  }
  const db = getServiceClient();
  if (!db) return cabiCharacterBibleDefaults;
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value_json")
      .eq("key", cabiCharacterBibleKey)
      .maybeSingle();
    if (error || !data) return cabiCharacterBibleDefaults;
    const parsed = parseCabiCharacterBible(data.value_json);
    bibleCache.set("bible", parsed);
    return parsed;
  } catch {
    return cabiCharacterBibleDefaults;
  }
}

export async function writeCabiCharacterBible(input: { artDirection: string; negative: string }, actor: string): Promise<CabiCharacterBible> {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const parsed = cabiCharacterBibleSchema.parse({
    artDirection: input.artDirection ?? "",
    negative: input.negative ?? "",
  });
  const artDirection = sanitizeVisualGuidance(parsed.artDirection, "artDirection");
  const negative = sanitizeVisualGuidance(parsed.negative, "negative");
  const value: CabiCharacterBible = {
    artDirection,
    negative,
    customized: artDirection.length > 0 || negative.length > 0,
  };
  const { error } = await db.from("app_settings").upsert(
    { key: cabiCharacterBibleKey, value_json: { artDirection: value.artDirection, negative: value.negative }, updated_by: actor },
    { onConflict: "key" },
  );
  if (error) throw new Error("SAVE_FAILED");
  bibleCache.set("bible", value);
  return value;
}

/** Removes the owner's overrides so the shipped bible applies again. */
export async function resetCabiCharacterBible(): Promise<CabiCharacterBible> {
  const db = getServiceClient();
  if (!db) return cabiCharacterBibleDefaults;
  await db.from("app_settings").delete().eq("key", cabiCharacterBibleKey);
  bibleCache.clear();
  return cabiCharacterBibleDefaults;
}

/**
 * The identity layers as they will actually be sent, including owner notes.
 *
 * Exposed so the admin console can be honest about what the model receives
 * without ever showing the raw prompt to a browser: this is the *description* of
 * the layers, and the assembled prompt stays server-side.
 */
export function cabiIdentityLayers(input: { artDirection?: string; composition?: string } = {}) {
  let notes = "";
  try {
    notes = sanitizeVisualGuidance(input.artDirection ?? "", "artDirection");
  } catch {
    notes = "";
  }
  return {
    identity: cabiCanonicalIdentity,
    // Owner art direction is appended to composition, never to identity.
    composition: notes ? `${input.composition ?? cabiComposition} ${notes}.` : (input.composition ?? cabiComposition),
    quality: cabiQuality,
  };
}
