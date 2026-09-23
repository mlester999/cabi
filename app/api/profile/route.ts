import { z } from "zod";

import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { completeProfile, readProfile } from "@/lib/profiles/service";
import { initialsFor, usernameRules } from "@/lib/profiles/username";
import { guardAppApi } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

const setupSchema = z.object({
  username: z.string().trim().min(1).max(40),
  displayName: z.string().trim().max(40).optional().nullable(),
  showBondPublicly: z.boolean().optional(),
});

/**
 * The authenticated user's profile.
 *
 * Drives the mandatory setup modal: `profileComplete` is false for a wallet that
 * has authenticated but never claimed a username, which is the gate for the
 * social and ranked features. Guest chat is unaffected.
 */
export async function GET() {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const profile = await readProfile(auth.identity.walletAccountId);
  return Response.json(
    {
      connected: true,
      profileComplete: Boolean(profile?.profileCompletedAt && profile.username),
      profile: profile
        ? {
          username: profile.username,
          displayName: profile.displayName,
          initials: profile.username ? initialsFor(profile.username) : null,
          avatarPath: profile.avatarPath,
          showBondPublicly: profile.showBondPublicly,
          rankingStatus: profile.rankingStatus,
          lifetimeXp: profile.lifetimeXp,
        }
        : null,
      usernameRules: { minLength: usernameRules.minLength, maxLength: usernameRules.maxLength },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Completes profile setup.
 *
 * The wallet comes from the signed session, never from the body, so a caller
 * cannot complete someone else's profile. Username uniqueness is enforced by the
 * database index rather than a read-then-write check.
 */
export async function POST(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("That name does not look right.", 400, "INVALID_INPUT");

  const result = await completeProfile(auth.identity.walletAccountId, {
    username: parsed.data.username,
    displayName: parsed.data.displayName ?? null,
    showBondPublicly: parsed.data.showBondPublicly,
  });
  if (!result.ok) return jsonError(result.message, result.reason === "USERNAME_TAKEN" ? 409 : 400, result.reason);

  return Response.json(
    {
      ok: true,
      profile: {
        username: result.profile.username,
        displayName: result.profile.displayName,
        initials: result.profile.username ? initialsFor(result.profile.username) : null,
        avatarPath: result.profile.avatarPath,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}