import { z } from "zod";

import { featureGate } from "@/lib/config/feature-gate";
import { readProfileBadges, saveProfileBadgeShowcase } from "@/lib/profile-badges/service";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

const showcaseSchema = z.object({ badgeIds: z.array(z.string().uuid()).max(3) })
  .refine(({ badgeIds }) => new Set(badgeIds).size === badgeIds.length);

/** The owner may choose up to three already-awarded badges for their profile. */
export async function PATCH(request: Request) {
  const locked = await featureGate("profile_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const parsed = showcaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose up to three different badges.", 400, "INVALID_INPUT");

  const current = await readProfileBadges(auth.identity.walletAccountId);
  if (!current.available) return jsonError("Profile badges are not available right now.", 503, "BADGES_UNAVAILABLE");
  const assigned = new Set(current.badges.map((badge) => badge.id));
  if (parsed.data.badgeIds.some((id) => !assigned.has(id))) return jsonError("You can only showcase badges awarded to your profile.", 400, "BADGE_NOT_ASSIGNED");

  const saved = await saveProfileBadgeShowcase(auth.identity.walletAccountId, parsed.data.badgeIds);
  if (!saved) return jsonError("I couldn't save your badge selection.", 503, "BADGE_SHOWCASE_FAILED");
  return Response.json({ ok: true, badgeIds: parsed.data.badgeIds }, { headers: { "Cache-Control": "private, no-store" } });
}
