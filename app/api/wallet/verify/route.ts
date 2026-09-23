import { clientAddress, assertSameOrigin, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createWalletAuthRuntime, verifyWalletChallenge, WalletAuthError } from "@/lib/wallet/auth";
import { serializeWalletSessionCookie } from "@/lib/wallet/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return jsonError("Invalid request.", 403, "INVALID_ORIGIN");
  }
  const limited = await checkRateLimit("wallet.verify", clientAddress(request), 20, 10 * 60);
  if (!limited.allowed) {
    return new Response(JSON.stringify({ error: "Too many sign-in attempts. Try again shortly.", code: "RATE_LIMITED" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Retry-After": String(limited.retryAfter) },
    });
  }

  try {
    const body = await request.json().catch(() => null) as { message?: unknown; signature?: unknown } | null;
    if (!body) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
    const { identity, cookieValue } = await verifyWalletChallenge(
      { message: body.message, signature: body.signature },
      createWalletAuthRuntime(),
    );
    const response = Response.json({
      authenticated: true,
      wallet: {
        address: identity.walletAddress,
        walletAccountId: identity.walletAccountId,
        profileId: identity.profileId,
      },
      expiresAt: identity.expiresAt,
    }, { headers: { "Cache-Control": "private, no-store" } });
    response.headers.append("Set-Cookie", serializeWalletSessionCookie(cookieValue));
    return response;
  } catch (error) {
    if (error instanceof WalletAuthError) return jsonError(error.message, error.status, error.code);
    return jsonError("Wallet sign-in is temporarily unavailable.", 503, "WALLET_AUTH_UNAVAILABLE");
  }
}

