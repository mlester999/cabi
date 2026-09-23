import { readLeaderboard, readStanding } from "@/lib/ranking/service";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApi } from "@/lib/site/guard";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/**
 * Leaderboard reads.
 *
 * Weekly and monthly share one shape. The response never contains a wallet
 * address: ranking is published by username only, and every row is filtered to
 * accounts that completed a profile. The season's `endsAt` is a server timestamp
 * so the client countdown is anchored to real data rather than a local guess.
 */
export async function GET(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("leaderboard_enabled");
  if (locked) return locked;
  const blocked = await guardAppApi();
  if (blocked) return blocked;

  const url = new URL(request.url);
  const type = url.searchParams.get("type")?.toUpperCase() === "MONTHLY" ? "MONTHLY" : "WEEKLY";

  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }

  const [{ season, entries, available }, standing] = await Promise.all([
    readLeaderboard(type, { walletAccountId: wallet?.walletAccountId ?? null, limit: 100 }),
    wallet ? readStanding(wallet.walletAccountId, type) : Promise.resolve(null),
  ]);

  return Response.json(
    {
      type,
      season,
      // False when the ranking store could not be read, so the client can tell
      // "nobody has earned XP yet" apart from "the board is unavailable".
      available,
      entries,
      standing,
      // The signed-in user is always included, even outside the top 100.
      you: entries.find((entry) => entry.isCurrentUser) ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}