import type { MetadataRoute } from "next";

import { env } from "@/lib/config/env";

function origin() {
  const configured = env("APP_URL");
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * Public routes only. `/settings` is included because it is a real public route
 * in LIVE mode; it self-reports `noindex` while the site is in prelaunch.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = origin();
  if (!base) return [];
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/cpu`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/settings`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}
