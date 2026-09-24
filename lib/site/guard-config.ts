/**
 * Route groups gated by the site mode.
 *
 * Isomorphic on purpose: the server guard reads them, and a test asserts that
 * every unfinished public endpoint is covered. Adding a new unfinished endpoint
 * without listing it here is the mistake this file exists to make visible.
 */

/** Unfinished public application APIs: closed unless the site is LIVE or previewing. */
export const appApiRoutePrefixes = [
  "/api/chat",
  "/api/conversations",
  "/api/memories",
  "/api/messages",
  "/api/settings",
  "/api/data",
  // Wallet-aware and social surfaces. Each also calls guardAppApi() in its own
  // handler, but listing them here means the middleware refuses the request
  // before a handler ever runs.
  "/api/portfolio",
  "/api/cabi",
  "/api/profile",
  "/api/rank",
  "/api/images",
  "/api/gallery",
] as const;

/**
 * Public reads that stay reachable in every site mode.
 *
 * The leaderboard is public by design: it publishes usernames and XP only, never
 * a wallet address, so a visitor can see the standings before connecting.
 */
export const publicReadApiRoutePrefixes = ["/api/leaderboard"] as const;

/** Always reachable in every site mode: identity, public config, sessions, admin. */
export const alwaysPublicApiRoutePrefixes = [
  "/api/wallet/",
  "/api/public/config",
  "/api/session",
  // Reports the holder-gate status for the signed-in wallet in every site mode,
  // so the UI can say "not open yet" instead of "you don't hold enough".
  "/api/cpu/access",
  "/api/admin/",
] as const;

/** Public application pages that follow the site mode. */
export const appPagePaths = ["/", "/settings"] as const;

/**
 * Server-rendered pages that require the $CPU holder gate while the site is
 * LIVE. Each one calls `guardAppPage()` and renders the holder gate instead of
 * the application, so a direct navigation to a protected path is decided on the
 * server rather than in the browser.
 */
export const holderGatedPagePaths = [
  "/",
  "/settings",
  "/settings/memory",
  "/profile",
] as const;

/** Admin-only surfaces that must keep working during PRELAUNCH and MAINTENANCE. */
export const adminOnlyPaths = ["/admin", "/preview"] as const;

export function matchesRoutePrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => {
    if (prefix.endsWith("/")) return pathname.startsWith(prefix);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export function isGatedAppApiPath(pathname: string) {
  return matchesRoutePrefix(pathname, appApiRoutePrefixes);
}

export function isAlwaysPublicApiPath(pathname: string) {
  return matchesRoutePrefix(pathname, alwaysPublicApiRoutePrefixes);
}
