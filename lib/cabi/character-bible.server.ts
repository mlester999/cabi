import "server-only";

import {
  cabiCanonicalIdentity,
  cabiComposition,
  cabiQuality,
  sanitizeScene,
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
  /** What the model should avoid. Replaces the shipped negative prompt when set. */
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

export const cabiCharacterBibleTtlMs = 30_000;

const bibleCache = createTtlCache<CabiCharacterBible>(cabiCharacterBibleTtlMs, 4);

export function invalidateCabiCharacterBibleCache() {
  bibleCache.clear();
}

export function parseCabiCharacterBible(value: unknown, fallback: CabiCharacterBible = cabiCharacterBibleDefaults): CabiCharacterBible {
  const parsed = cabiCharacterBibleSchema.partial().safeParse(value ?? {});
  if (!parsed.success) return fallback;
  const artDirection = (parsed.data.artDirection ?? fallback.artDirection).trim();
  const negative = (parsed.data.negative ?? fallback.negative).trim();
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
  const value = parseCabiCharacterBible(parsed);
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
export function cabiIdentityLayers(input: { artDirection?: string } = {}) {
  const notes = sanitizeScene(input.artDirection ?? "", 600);
  return {
    identity: cabiCanonicalIdentity,
    // Owner art direction is appended to composition, never to identity.
    composition: notes ? `${cabiComposition} ${notes}.` : cabiComposition,
    quality: cabiQuality,
  };
}
