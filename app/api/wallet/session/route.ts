import { readWalletAuth } from "@/lib/wallet/session";

export async function GET() {
  try {
    const identity = await readWalletAuth();
    if (!identity) {
      return Response.json(
        { authenticated: false, error: "Wallet sign-in required.", code: "WALLET_UNAUTHORIZED" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json({
      authenticated: true,
      wallet: {
        address: identity.walletAddress,
        walletAccountId: identity.walletAccountId,
        profileId: identity.profileId,
      },
      expiresAt: identity.expiresAt,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json(
      { authenticated: false, error: "Wallet sign-in is temporarily unavailable.", code: "WALLET_AUTH_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

