import "server-only";

import { jsonError } from "@/lib/security/request";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import type { FeatureFlags } from "@/lib/config/feature-flags";

/**
 * Refuses an API whose feature is not shipping yet.
 *
 * Locking the page is not enough on its own: the page and the endpoint are
 * separate entry points, so a locked feature must close both or the data is
 * still one fetch away. Returns a 404 rather than a 403 so a locked endpoint
 * does not confirm that it exists.
 */
export async function featureGate(key: keyof FeatureFlags): Promise<Response | null> {
  const flags = await readFeatureFlags();
  if (flags[key]) return null;
  return jsonError("This part of Cabi isn't open yet.", 404, "FEATURE_LOCKED");
}