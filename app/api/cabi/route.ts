import { guardAppApi } from "@/lib/site/guard";
import { readBondProfile } from "@/lib/bond-profile";
import { inferMood } from "@/lib/cabi/mood";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/**
 * The authenticated user's relationship with Cabi.
 *
 * Scoped to the wallet in the signed session cookie, so there is no parameter
 * that could request another account's bond. Returns a disconnected shape rather
 * than a 401 so the page can render a friendly connect prompt.
 */
export async function GET(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;

  let wallet;
  try {
    wallet = await readWalletAuth();
  } catch {
    return Response.json({ connected: false, message: "Wallet sign-in is temporarily unavailable." }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (!wallet) {
    return Response.json(
      { connected: false, message: "Connect and sign in with an EVM wallet and I can remember our chats." },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const profile = await readBondProfile(wallet.walletAccountId, wallet.profileId);
  // Mood is derived from real signals so it stays stable between reloads.
  const hour = Number(new URL(request.url).searchParams.get("hour"));
  const mood = inferMood({ hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined });

  return Response.json(
    { connected: true, profile, mood },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}