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
 * Robots policy.
 *
 * The public pages are indexable even during PRELAUNCH — the prelaunch page is
 * a finished public page, not a placeholder. Admin, preview, and maintenance
 * surfaces are excluded, and `/api/` is disallowed so unfinished endpoints are
 * never advertised.
 */
export default function robots(): MetadataRoute.Robots {
  const base = origin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/cpu"],
        disallow: ["/admin", "/admin/", "/preview", "/preview/", "/maintenance", "/api/"],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
    host: base ?? undefined,
  };
}
