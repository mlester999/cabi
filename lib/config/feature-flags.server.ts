import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { defaultFeatureFlags, parseFeatureFlags, type FeatureFlags } from "@/lib/config/feature-flags";

/**
 * Server-side flag resolution.
 *
 * Flags live in `app_settings` under the `feature_flags` key and are read with
 * the service role. There is deliberately no client-visible copy of the raw
 * setting and no way for a request to influence them.
 *
 * A database failure resolves to the built-in defaults rather than to "all on",
 * so an outage can never unlock an unfinished feature.
 */

export const featureFlagsSettingKey = "feature_flags";

export async function readFeatureFlags(): Promise<FeatureFlags> {
  const db = getServiceClient();
  if (!db) return { ...defaultFeatureFlags };
  try {
    const { data, error } = await db.from("app_settings").select("value_json").eq("key", featureFlagsSettingKey).maybeSingle();
    if (error || !data) return { ...defaultFeatureFlags };
    return parseFeatureFlags(data.value_json);
  } catch {
    return { ...defaultFeatureFlags };
  }
}

export async function writeFeatureFlags(flags: FeatureFlags, actor: string) {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { error } = await db
    .from("app_settings")
    .upsert({ key: featureFlagsSettingKey, value_json: flags, updated_by: actor }, { onConflict: "key" });
  if (error) throw new Error("SAVE_FAILED");
}

/** Convenience for a single gate. Returns false when the flag is off. */
export async function isFeatureEnabled(key: keyof FeatureFlags): Promise<boolean> {
  const flags = await readFeatureFlags();
  return flags[key] === true;
}