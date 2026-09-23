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
 * 1. Environment override (`SITE_MODE`, then `NEXT_PUBLIC_SITE_MODE`). Any
 *    valid explicit value wins, including over the database.
 * 2. Database site setting — changeable from the dashboard without a redeploy.
 * 3. `PRELAUNCH` — fail closed if no explicit launch decision exists.
 *
 * Leave the environment value blank for normal dashboard control. Setting it is
 * an emergency operator lock and the admin UI cannot override it.
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
