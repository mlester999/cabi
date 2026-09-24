import "server-only";

import { cabiStatusDefaults, cabiStatusTypes, type CabiStatusOverrides, type CabiStatusType } from "@/lib/cabi/status-messages";
import { getServiceClient } from "@/lib/db/supabase";
import { createTtlCache } from "@/lib/wallet-data/cache";
import { z } from "zod";

/**
 * Owner-added Cabi activity messages.
 *
 * The built-in catalogue in `lib/cabi/status-messages.ts` is what ships, and it is
 * never removed: an owner adds lines, they do not replace the defaults. That is
 * deliberate — a category with nothing to say would leave the UI silent, which is
 * exactly the generic-spinner feeling this feature exists to avoid.
 *
 * So this module stores *extras* only, and `resolveStatusMessages()` unions them
 * with the defaults at read time. No configuration can produce an empty rotation.
 */

export const cabiStatusMessagesKey = "cabi_status_messages";

/** The longest an owner-added line may be. Matches the built-in cap. */
export const cabiStatusMaxLength = 120;

/** How many extra lines a category accepts, so the rotation stays coherent. */
export const cabiStatusMaxPerCategory = 20;

export type CabiStatusMessageSettings = {
  /** Whether the owner's extra lines are in use. */
  enabled: boolean;
  /** Extra lines per category, appended to the built-in defaults. */
  custom: CabiStatusOverrides;
};

export const cabiStatusMessageDefaults: CabiStatusMessageSettings = { enabled: false, custom: {} };

const lineSchema = z.string().trim().min(1).max(cabiStatusMaxLength);

// The array element is intentionally unconstrained here and validated per line in
// `parseCabiStatusMessages`: a single over-long entry must drop itself rather than
// reject the owner's other lines.
export const cabiStatusMessagesSchema = z.object({
  enabled: z.boolean().optional(),
  custom: z.record(z.string(), z.array(z.string()).max(cabiStatusMaxPerCategory + 20)).optional(),
});

export const cabiStatusMessagesTtlMs = 30_000;

const cache = createTtlCache<CabiStatusMessageSettings>(cabiStatusMessagesTtlMs, 4);

export function invalidateCabiStatusMessagesCache() {
  cache.clear();
}

/** Keeps only known categories, and only lines that pass validation. */
export function parseCabiStatusMessages(value: unknown): CabiStatusMessageSettings {
  const parsed = cabiStatusMessagesSchema.safeParse(value ?? {});
  if (!parsed.success) return cabiStatusMessageDefaults;

  const custom: CabiStatusOverrides = {};
  for (const type of cabiStatusTypes) {
    const raw = parsed.data.custom?.[type];
    if (!raw?.length) continue;
    // Validation is per line, not per record: one over-long entry drops itself
    // rather than discarding the owner's other lines.
    const cleaned = raw
      .map((line) => line.trim())
      .filter((line) => {
        const result = lineSchema.safeParse(line);
        return result.success;
      });
    const unique = [...new Set(cleaned)];
    if (unique.length > 0) custom[type] = unique.slice(0, cabiStatusMaxPerCategory);
  }
  return { enabled: parsed.data.enabled ?? false, custom };
}

/**
 * The extras that should actually be applied.
 *
 * Returns nothing when the owner has not enabled them, so "off" is a real off
 * switch rather than an empty list that happens to match.
 */
export async function readCabiStatusMessages(options: { fresh?: boolean } = {}): Promise<CabiStatusMessageSettings> {
  if (!options.fresh) {
    const hit = cache.get("messages");
    if (hit) return hit.value;
  }
  const db = getServiceClient();
  if (!db) return cabiStatusMessageDefaults;
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value_json")
      .eq("key", cabiStatusMessagesKey)
      .maybeSingle();
    if (error || !data) return cabiStatusMessageDefaults;
    const parsed = parseCabiStatusMessages(data.value_json);
    cache.set("messages", parsed);
    return parsed;
  } catch {
    return cabiStatusMessageDefaults;
  }
}

/** The extras to hand to the component: empty unless enabled. */
export async function readActiveStatusOverrides(): Promise<CabiStatusOverrides | null> {
  const settings = await readCabiStatusMessages();
  return settings.enabled ? settings.custom : null;
}

export async function writeCabiStatusMessages(input: CabiStatusMessageSettings, actor: string): Promise<CabiStatusMessageSettings> {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const parsed = parseCabiStatusMessages(input);
  const { error } = await db.from("app_settings").upsert(
    { key: cabiStatusMessagesKey, value_json: parsed, updated_by: actor },
    { onConflict: "key" },
  );
  if (error) throw new Error("SAVE_FAILED");
  cache.set("messages", parsed);
  return parsed;
}

export async function resetCabiStatusMessages(): Promise<CabiStatusMessageSettings> {
  const db = getServiceClient();
  if (!db) return cabiStatusMessageDefaults;
  await db.from("app_settings").delete().eq("key", cabiStatusMessagesKey);
  cache.clear();
  return cabiStatusMessageDefaults;
}

/** The shipped lines, for the admin screen's read-only defaults view. */
export function cabiStatusDefaultLines(): Record<CabiStatusType, readonly string[]> {
  return cabiStatusDefaults;
}
