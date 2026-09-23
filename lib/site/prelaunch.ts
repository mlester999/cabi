import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { defaultPrelaunchSettings, type PrelaunchSettings } from "@/lib/site/prelaunch-shared";
import { httpsUrlOrEmpty } from "@/lib/wallet/config";
import { z } from "zod";

export type { PrelaunchSettings } from "@/lib/site/prelaunch-shared";
export { defaultPrelaunchSettings } from "@/lib/site/prelaunch-shared";

/** app_settings key holding the owner-editable prelaunch copy. */
export const prelaunchSettingKey = "prelaunch_config";

/**
 * Owner-editable copy for the public prelaunch page.
 *
 * Every field has a safe default, so an unconfigured database still renders a
 * finished-looking page and never invents a contract address or release date.
 * The schema is deliberately looser than the database check constraint and
 * stricter than the renderer, so a save fails loudly instead of publishing a
 * half-valid page.
 */
export const prelaunchSettingsSchema = z.object({
  headline: z.string().trim().min(1, "A headline is required.").max(120),
  subheadline: z.string().trim().min(1, "A description is required.").max(200),
  description: z.string().trim().min(1, "Supporting copy is required.").max(600),
  statusLabel: z.string().trim().min(1).max(40),
  announcement: z.string().trim().max(240),
  xUrl: httpsUrlOrEmpty,
  communityUrl: httpsUrlOrEmpty,
  showSocial: z.boolean(),
  showCpu: z.boolean(),
  cpuStatus: z.enum(["PRELAUNCH", "LIVE"]),
  featureChips: z.array(z.string().trim().min(1).max(24)).max(6),
});

export type PrelaunchSettingsInput = z.infer<typeof prelaunchSettingsSchema>;

export function parsePrelaunchSettings(value: unknown): PrelaunchSettings {
  const parsed = prelaunchSettingsSchema.partial().safeParse(value ?? {});
  const merged = { ...defaultPrelaunchSettings, ...(parsed.success ? parsed.data : {}) };
  return {
    ...merged,
    featureChips: merged.featureChips?.length ? merged.featureChips : defaultPrelaunchSettings.featureChips,
  };
}

export async function getPrelaunchSettings(): Promise<PrelaunchSettings> {
  const db = getServiceClient();
  if (!db) return defaultPrelaunchSettings;
  const { data, error } = await db
    .from("app_settings")
    .select("value_json")
    .eq("key", prelaunchSettingKey)
    .maybeSingle();
  // A read failure falls back to the built-in copy rather than an empty page.
  if (error || !data) return defaultPrelaunchSettings;
  return parsePrelaunchSettings(data.value_json);
}

/**
 * $CPU publication state is owned by the wallet/CPU configuration, not by the
 * prelaunch copy. This normalises the two switches into one value that the page
 * can render truthfully.
 */
export function cpuPublicationState(cpuStatus: PrelaunchSettings["cpuStatus"], live: boolean): "PRELAUNCH" | "LIVE" {
  return cpuStatus === "LIVE" && live ? "LIVE" : "PRELAUNCH";
}
