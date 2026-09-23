import { defaultSiteMode, isSiteMode, type SiteMode } from "@/lib/site/mode-shared";

/**
 * Pure site-mode precedence resolution.
 *
 * Split out of `lib/site/mode.ts` (which is `server-only`) so the precedence
 * rules can be unit tested without a request context or a database.
 */
export type SiteModeSource = "env" | "database" | "default";

export type ResolvedSiteMode = {
  mode: SiteMode;
  source: SiteModeSource;
  /** True when an operator forced the mode through the environment. */
  override: boolean;
};

export function normalizeSiteMode(value: string | undefined | null): SiteMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return isSiteMode(normalized) ? (normalized as SiteMode) : null;
}

/**
 * Precedence, highest first:
 *
 * 1. Emergency environment override — `SITE_MODE_OVERRIDE`. It is the only
 *    environment variable consulted for access control, it is server-only, and
 *    it is never inlined into client bundles. A valid value always wins so an
 *    operator can force the site state without touching the database.
 * 2. Database site setting (`app_settings.site_mode`) — the normal source of
 *    truth, changeable from `/admin/settings` without a redeploy.
 * 3. `PRELAUNCH` — fail closed when no explicit launch decision exists.
 *
 * Normal production leaves the override blank and launches from the dashboard.
 */
export function resolveSiteModePrecedence(input: {
  environmentMode?: string | null;
  databaseMode?: string | null;
}): ResolvedSiteMode {
  const environment = normalizeSiteMode(input.environmentMode);
  const stored = normalizeSiteMode(input.databaseMode);

  if (environment) return { mode: environment, source: "env", override: true };
  if (stored) return { mode: stored, source: "database", override: false };
  return { mode: defaultSiteMode, source: "default", override: false };
}

export function siteModeAllowsApp(mode: SiteMode) {
  return mode === "LIVE";
}
