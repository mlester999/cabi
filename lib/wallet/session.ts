import "server-only";

import { cookies } from "next/headers";

import { isProduction } from "@/lib/config/env";
import {
  authenticateWalletCookie,
  createWalletAuthRuntime,
  WalletAuthError,
  walletSessionCookieName,
  walletSessionTtlMs,
} from "@/lib/wallet/auth";

export function serializeWalletSessionCookie(value: string) {
  const secure = isProduction() ? "; Secure" : "";
  return `${walletSessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(walletSessionTtlMs / 1_000)}${secure}`;
}

export function clearWalletSessionCookie() {
  const secure = isProduction() ? "; Secure" : "";
  return `${walletSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function readWalletAuth() {
  const jar = await cookies();
  const cookieValue = jar.get(walletSessionCookieName)?.value;
  // Guests must not touch Supabase. Build the DB-backed runtime only when an
  // actual wallet credential is present.
  if (!cookieValue) return null;
  return authenticateWalletCookie(cookieValue, createWalletAuthRuntime());
}

export async function requireWalletAuth() {
  const identity = await readWalletAuth();
  if (!identity) throw new WalletAuthError("WALLET_UNAUTHORIZED", "Connect and sign in with your wallet to continue.", 401);
  return identity;
}

export async function walletAuthOrResponse() {
  try {
    return { identity: await requireWalletAuth(), response: null };
  } catch (error) {
    const unavailable = error instanceof Error && (
      error.message === "DATABASE_NOT_CONFIGURED" ||
      error.message === "SESSION_SECRET_NOT_CONFIGURED" ||
      error.message.startsWith("WALLET_AUTH_DATABASE_ERROR:")
    );
    return {
      identity: null,
      response: Response.json(
        unavailable
          ? { error: "Wallet sign-in is temporarily unavailable.", code: "WALLET_AUTH_UNAVAILABLE" }
          : { error: "Connect and sign in with your wallet to continue.", code: "WALLET_UNAUTHORIZED" },
        { status: unavailable ? 503 : 401, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
}
