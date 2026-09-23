/**
 * Isomorphic site-mode vocabulary.
 *
 * Kept out of `lib/site/mode.ts` (which is `server-only`) so that admin client
 * components can render labels without pulling in database access.
 */
export type SiteMode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";

export const siteModes: readonly SiteMode[] = ["PRELAUNCH", "LIVE", "MAINTENANCE"] as const;

/** The product opens directly into Cabi unless the owner explicitly pauses it. */
export const defaultSiteMode: SiteMode = "LIVE";

export const siteModeLabels: Record<SiteMode, string> = {
  PRELAUNCH: "Prelaunch",
  LIVE: "Live",
  MAINTENANCE: "Maintenance",
};

export const siteModeDescriptions: Record<SiteMode, string> = {
  PRELAUNCH: "The public sees Cabi's animated prelaunch page. Only admins can open the full application.",
  LIVE: "The full Cabi application is publicly available at / and /settings.",
  MAINTENANCE: "The public sees a short maintenance notice. Only admins can open the full application.",
};

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === "string" && (siteModes as readonly string[]).includes(value.toUpperCase());
}
