import { guardAppApi } from "@/lib/site/guard";
import { jsonError } from "@/lib/security/request";
import { readWalletSnapshot } from "@/lib/wallet-data/client";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/**
 * Portfolio read.
 *
 * The address comes from the verified wallet session cookie, never from the
 * request, so this endpoint cannot be used to read a wallet the caller does not
 * control. Chain configuration comes from owner settings. There is no query
 * parameter that influences which RPC is contacted.
 *
 * Response shape is intentionally narrow: the caller gets the snapshot or a
 * typed error code. No price, USD value, or transaction history is returned
 * because no verified source for those exists in this product.
 */
export async function GET(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;

  let wallet;
  try {
    wallet = await readWalletAuth();
  } catch {
    return jsonError("Wallet sign-in is temporarily unavailable.", 503, "WALLET_AUTH_UNAVAILABLE");
  }
  if (!wallet) {
    return Response.json(
      { connected: false, error: "WALLET_NOT_CONNECTED", message: "Connect and sign in with an EVM wallet to see your holdings." },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const url = new URL(request.url);
  const requestedChain = Number(url.searchParams.get("chainId"));
  const chainId = Number.isSafeInteger(requestedChain) && requestedChain > 0 ? requestedChain : null;
  const fresh = url.searchParams.get("fresh") === "1";

  const result = await readWalletSnapshot({ address: wallet.walletAddress, chainId, fresh });
  if (!result.ok) {
    return Response.json(
      { connected: true, error: result.error, message: result.message },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return Response.json(
    { connected: true, snapshot: result.data, updatedAt: result.updatedAt, stale: result.stale },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}