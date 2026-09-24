import { clientAddress, assertSameOrigin, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { cpuBuyUrlFor } from "@/lib/cpu-access/config";
import { resolveCabiAccessForSession } from "@/lib/cpu-access/resolve";
import { readCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { cpuHolderStatusPayload } from "@/lib/cpu-access/status.server";
import { createOwnerPreviewToken, clearOwnerPreviewCookie, serializeOwnerPreviewCookie } from "@/lib/site/owner-preview";
import { isAuthorizedOwnerWallet, markOwnerWalletUsed } from "@/lib/site/owner-wallets";
import { getSiteMode } from "@/lib/site/mode";
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
    // Authorization is evaluated only after the nonce and signature were
    // verified. A database failure simply leaves this as an ordinary wallet.
    const approved = await isAuthorizedOwnerWallet(identity.walletAddress).catch(() => false);
    let ownerPreviewToken: string | null = null;
    if (approved) {
      ownerPreviewToken = await createOwnerPreviewToken(identity).catch(() => null);
      if (ownerPreviewToken) await markOwnerWalletUsed(identity.walletAddress);
    }

    // The holder-gate answer is computed here, on the server, from the wallet
    // ownership that was just proven - never from anything the browser sent.
    // While the site is in PRELAUNCH this resolves to PRELAUNCH and touches no
    // RPC, so a $CPU balance can never unlock the prelaunch layer.
    const [{ mode }, { settings }] = await Promise.all([getSiteMode(), readCpuAccessGateSettings()]);
    const decision = await resolveCabiAccessForSession(identity, { mode });

    const response = Response.json({
      authenticated: true,
      previewAuthorized: Boolean(ownerPreviewToken),
      wallet: {
        address: identity.walletAddress,
        walletAccountId: identity.walletAccountId,
        profileId: identity.profileId,
      },
      expiresAt: identity.expiresAt,
      cpuHolder: cpuHolderStatusPayload(decision, cpuBuyUrlFor(settings.buyUrl)),
      minimumBalance: settings.minimumBalance,
    }, { headers: { "Cache-Control": "private, no-store" } });
    response.headers.append("Set-Cookie", serializeWalletSessionCookie(cookieValue));
    response.headers.append("Set-Cookie", ownerPreviewToken ? serializeOwnerPreviewCookie(ownerPreviewToken) : clearOwnerPreviewCookie());
    return response;
  } catch (error) {
    if (error instanceof WalletAuthError) return jsonError(error.message, error.status, error.code);
    return jsonError("Wallet sign-in is temporarily unavailable.", 503, "WALLET_AUTH_UNAVAILABLE");
  }
}
