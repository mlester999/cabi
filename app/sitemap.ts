import type { MetadataRoute } from "next";

import { siteOrigin } from "@/lib/site/origin";

/**
 * Public routes only. `/settings` is included because it is a real public route
 * in LIVE mode; it self-reports `noindex` while the site is in prelaunch.
 *
 * The origin comes from `APP_URL`, falling back to the hosting platform's own
 * deployment host, so a deploy that forgets to set `APP_URL` still emits a
 * usable sitemap instead of an empty one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteOrigin();
  if (!base) return [];
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/cpu`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/settings`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}
