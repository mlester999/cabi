import { readAllTimeLeaderboard, readAllTimeStanding, readLeaderboard, readStanding } from "@/lib/ranking/service";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApiCpu } from "@/lib/site/guard";
import { readWalletAuth } from "@/lib/wallet/session";
import { readProfile } from "@/lib/profiles/service";
import { readLeaderboardBadgeMap } from "@/lib/profile-badges/service";

export const dynamic = "force-dynamic";

/**
 * Leaderboard reads.
 *
 * Period and lifetime boards share one shape. The response never contains a wallet
 * address: ranking is published by username only, and every row is filtered to
 * accounts that completed a profile. The season's `endsAt` is a server timestamp
 * so the client countdown is anchored to real data rather than a local guess.
 */
export async function GET(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("leaderboard_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;

  const url = new URL(request.url);
  const requested = url.searchParams.get("type")?.toUpperCase();
  const type = requested === "MONTHLY" ? "MONTHLY" : requested === "ALL_TIME" ? "ALL_TIME" : "WEEKLY";

  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }

  const [{ season, entries, available }, standing, profile] = await Promise.all([
    type === "ALL_TIME"
      ? readAllTimeLeaderboard({ walletAccountId: wallet?.walletAccountId ?? null, limit: 100 }).then((result) => ({ ...result, season: null }))
      : readLeaderboard(type, { walletAccountId: wallet?.walletAccountId ?? null, limit: 100 }),
    wallet ? (type === "ALL_TIME" ? readAllTimeStanding(wallet.walletAccountId) : readStanding(wallet.walletAccountId, type)) : Promise.resolve(null),
    wallet ? readProfile(wallet.walletAccountId) : Promise.resolve(null),
  ]);

  const badgeMap = await readLeaderboardBadgeMap(entries.map((entry) => entry.walletAccountId));
  const publicEntries = entries.map(({ walletAccountId, ...entry }) => ({
    ...entry,
    profileBadge: badgeMap.get(walletAccountId) ?? null,
  }));

  return Response.json(
    {
      type,
      season,
      // False when the ranking store could not be read, so the client can tell
      // "nobody has earned XP yet" apart from "the board is unavailable".
      available,
      // Account IDs stay server-side; one showcased badge may be shown beside a name.
      entries: publicEntries,
      standing,
      currentUser: wallet ? { username: profile?.username ?? null, displayName: profile?.displayName ?? null } : null,
      // The signed-in user is always included, even outside the top 100.
      you: publicEntries.find((entry) => entry.isCurrentUser) ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
