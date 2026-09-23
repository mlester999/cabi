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
] as const;

/** Always reachable in every site mode: identity, public config, sessions, admin. */
export const alwaysPublicApiRoutePrefixes = [
  "/api/wallet/",
  "/api/public/config",
  "/api/session",
  "/api/admin/",
] as const;

/** Public application pages that follow the site mode. */
export const appPagePaths = ["/", "/settings"] as const;

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
