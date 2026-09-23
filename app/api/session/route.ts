import { readWalletAuth } from "@/lib/wallet/session";

export async function GET() {
  try {
    const wallet = await readWalletAuth();
    return Response.json({
      authenticated: Boolean(wallet),
      mode: wallet ? "wallet" : "temporary",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json(
      { authenticated: false, error: "Wallet session is temporarily unavailable.", code: "WALLET_AUTH_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
