import "server-only";

import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { normalizeSiteMode, resolveSiteModePrecedence, siteModeAllowsApp, type ResolvedSiteMode } from "@/lib/site/mode-resolve";
import { isSiteMode, type SiteMode } from "@/lib/site/mode-shared";

export type { ResolvedSiteMode, SiteModeSource } from "@/lib/site/mode-resolve";
export { siteModeAllowsApp } from "@/lib/site/mode-resolve";
export type { SiteMode } from "@/lib/site/mode-shared";
export { defaultSiteMode, isSiteMode, siteModeDescriptions, siteModeLabels, siteModes } from "@/lib/site/mode-shared";

/** app_settings key holding `{ mode, updatedBy, updatedAt }`. */
export const siteModeSettingKey = "site_mode";

/**
 * Emergency environment override.
 *
 * `SITE_MODE` is preferred; `NEXT_PUBLIC_SITE_MODE` is accepted as a documented
 * fallback for hosts that only forward public variables. It is read on the
 * server only and is never inlined into client bundles by this module.
 */
export function environmentSiteMode(): string | null {
  const raw = env("SITE_MODE") ?? env("NEXT_PUBLIC_SITE_MODE");
  return raw ?? null;
}

export async function readDatabaseSiteMode(): Promise<SiteMode | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("app_settings")
    .select("value_json")
    .eq("key", siteModeSettingKey)
    .maybeSingle();
  if (error) throw new Error("SITE_MODE_UNAVAILABLE");
  if (!data) return null;
  const value = data.value_json as { mode?: unknown } | null;
  if (!isSiteMode(value?.mode)) throw new Error("SITE_MODE_INVALID");
  return normalizeSiteMode(String(value!.mode))!;
}

/** Persists the mode chosen in the admin dashboard. */
export async function writeDatabaseSiteMode(mode: SiteMode, actor: string) {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { error } = await db
    .from("app_settings")
    .upsert(
      { key: siteModeSettingKey, value_json: { mode, updatedBy: actor, updatedAt: new Date().toISOString() }, updated_by: actor },
      { onConflict: "key" },
    );
  if (error) throw new Error("SAVE_FAILED");
  invalidateSiteModeCache();
}

export async function resolveSiteMode(): Promise<ResolvedSiteMode> {
  const environmentMode = environmentSiteMode();
  const normalizedEnvironment = normalizeSiteMode(environmentMode);
  if (normalizedEnvironment) {
    return { mode: normalizedEnvironment, source: "env", override: true };
  }
  return resolveSiteModePrecedence({
    environmentMode,
    databaseMode: await readDatabaseSiteMode(),
  });
}

/**
 * Short-lived memoized resolver.
 *
 * The site mode is read by the layout, the page, and every guarded API route.
 * A very small positive TTL collapses those reads into one database query
 * without making the owner wait on a cache: an environment override is always
 * honoured immediately, and a saved dashboard change becomes visible within
 * `siteModeCacheTtlMs`. A failed read is never cached.
 */
export const siteModeCacheTtlMs = 5_000;

let cached: { at: number; value: Promise<ResolvedSiteMode> } | null = null;

export function invalidateSiteModeCache() {
  cached = null;
}

export function getSiteMode(): Promise<ResolvedSiteMode> {
  const now = Date.now();
  if (cached && now - cached.at < siteModeCacheTtlMs) return cached.value;
  const value = resolveSiteMode();
  cached = { at: now, value };
  void value.catch(() => {
    if (cached?.value === value) cached = null;
  });
  return value;
}

/**
 * Resolves the mode without trusting the memoized value. Preview opt-in and the
 * admin console use this so they always reflect the current setting.
 */
export async function getSiteModeUncached(): Promise<ResolvedSiteMode> {
  invalidateSiteModeCache();
  return getSiteMode();
}

/** Kept for callers that only have a mode value, not a resolved result. */
export function isAppLive(mode: SiteMode) {
  return siteModeAllowsApp(mode);
}
