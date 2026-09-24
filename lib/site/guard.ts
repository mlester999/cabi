import "server-only";

import { jsonError } from "@/lib/security/request";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode, siteModeAllowsApp } from "@/lib/site/mode";
import { readOwnerPreviewAuth } from "@/lib/site/owner-preview";
import { isPreviewActive } from "@/lib/site/preview";

export {
  adminOnlyPaths,
  alwaysPublicApiRoutePrefixes,
  appApiRoutePrefixes,
  appPagePaths,
  isAlwaysPublicApiPath,
  isGatedAppApiPath,
  matchesRoutePrefix,
} from "@/lib/site/guard-config";

export type ViewerKind = "visitor" | "admin" | "preview";

export type AppAccess = {
  /** The application UI and its APIs may be used. */
  allowed: boolean;
  /** Why access was granted, for building the preview chrome. */
  viewer: ViewerKind;
  /** True when the site is in its normal public LIVE state. */
  live: boolean;
  /** True when an unlocked admin is looking at a non-public site mode. */
  previewing: boolean;
};

/**
 * Single source of truth for "may this request reach the Cabi application?".
 *
 * - LIVE: everyone.
 * - PRELAUNCH / MAINTENANCE: an active admin preview or a verified wallet
 *   preview whose wallet remains on the server-side allowlist.
 *
 * This runs on the server for pages, layouts, and route handlers. It is the
 * enforcement point; the UI only ever reflects it.
 */
export async function getAppAccess(): Promise<AppAccess> {
  const { mode } = await getSiteMode();
  const live = siteModeAllowsApp(mode);
  if (live) return { allowed: true, viewer: "visitor", live: true, previewing: false };

  // Preview is only meaningful outside LIVE, so these reads are skipped entirely
  // on the public happy path.
  const session = await readAdminSession().catch(() => null);
  if (session && await isPreviewActive().catch(() => false)) {
    return { allowed: true, viewer: "preview", live: false, previewing: true };
  }
  if (mode === "PRELAUNCH" && await readOwnerPreviewAuth()) {
    return { allowed: true, viewer: "preview", live: false, previewing: true };
  }
  return { allowed: false, viewer: session ? "admin" : "visitor", live: false, previewing: false };
}

/**
 * Guard for route handlers that expose unfinished public functionality.
 *
 * Returns `null` when the request may continue, or a `404` response that
 * deliberately matches the public story: the endpoint does not exist yet.
 */
export async function guardAppApi(): Promise<Response | null> {
  const access = await getAppAccess();
  if (access.allowed) return null;
  return jsonError("This part of Cabi isn't open yet.", 404, "SITE_PRELAUNCH");
}
