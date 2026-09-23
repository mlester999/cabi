import "server-only";

import { env } from "@/lib/config/env";

/**
 * Last-resort public origin.
 *
 * Used only when neither `APP_URL` nor a hosting-platform variable is present,
 * so metadata and `robots.txt` never fall back to `localhost` on a real deploy.
 * The owner should set `APP_URL` to the real domain (`https://chatwithcabi.fun`)
 * for production.
 */
export const fallbackPublicOrigin = "https://cabi-cat-partner-unit.acakmarklester33.chatgpt.site";

/**
 * Canonical public origin, used for metadata, canonical links, robots, and the
 * sitemap.
 *
 * `APP_URL` is authoritative when the owner sets it. Otherwise the hosting
 * platform's own deployment host is used, which keeps preview deployments
 * correct. Vercel exposes the bare host without a protocol, so one is added when
 * missing.
 */
export function siteOrigin(): string {
  const configured = env("APP_URL")
    ?? env("VERCEL_PROJECT_PRODUCTION_URL")
    ?? env("VERCEL_URL")
    ?? fallbackPublicOrigin;
  const withProtocol = /^https?:\/\//u.test(configured) ? configured : `https://${configured}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return fallbackPublicOrigin;
  }
}

export function siteMetadataBase(): URL {
  return new URL(siteOrigin());
}
