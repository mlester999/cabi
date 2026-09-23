import { cookies } from "next/headers";

import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { createWalletAuthRuntime, revokeWalletCookie, walletSessionCookieName } from "@/lib/wallet/auth";
import { clearWalletSessionCookie } from "@/lib/wallet/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return jsonError("Invalid request.", 403, "INVALID_ORIGIN");
  }

  let revokeFailed = false;
  try {
    const jar = await cookies();
    await revokeWalletCookie(jar.get(walletSessionCookieName)?.value, createWalletAuthRuntime());
  } catch {
    revokeFailed = true;
  }
  // Keep the browser credential when revocation fails. Clearing the user's only
  // copy would make a still-valid stolen session impossible for them to revoke
  // by retrying sign-out after the database recovers.
  if (revokeFailed) {
    return Response.json(
      { ok: false, error: "Wallet sign-out could not be completed. Please try again.", code: "WALLET_AUTH_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const response = Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.headers.append("Set-Cookie", clearWalletSessionCookie());
  return response;
}
