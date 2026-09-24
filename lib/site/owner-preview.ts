import "server-only";

import { cookies } from "next/headers";

import { env, isProduction } from "@/lib/config/env";
import { signValue, verifySignedValue } from "@/lib/security/crypto";
import { validateOwnerPreviewToken } from "@/lib/site/owner-preview-rules";
import { isAuthorizedOwnerWallet } from "@/lib/site/owner-wallets";
import type { WalletAuthIdentity } from "@/lib/wallet/auth";
import { readWalletAuth } from "@/lib/wallet/session";

export const ownerPreviewCookieName = "cabi_owner_preview";
export const ownerPreviewTtlSeconds = 60 * 60 * 4;

function previewSecret() {
  const secret = env("SESSION_SECRET") ?? env("APP_ENCRYPTION_KEY");
  if (!secret) {
    if (isProduction()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
    return "cabi-development-session-secret-change-me";
  }
  return secret;
}

export async function createOwnerPreviewToken(identity: WalletAuthIdentity) {
  return signValue(JSON.stringify({
    scope: "wallet_preview",
    sessionId: identity.sessionId,
    walletAddressKey: identity.walletAddressUniqueKey,
    expiresAt: Date.now() + ownerPreviewTtlSeconds * 1_000,
  }), previewSecret());
}

const cookieSuffix = () => `; Path=/; HttpOnly; SameSite=Lax${isProduction() ? "; Secure" : ""}`;

export function serializeOwnerPreviewCookie(value: string) {
  return `${ownerPreviewCookieName}=${value}${cookieSuffix()}; Max-Age=${ownerPreviewTtlSeconds}`;
}

export function clearOwnerPreviewCookie() {
  return `${ownerPreviewCookieName}=${cookieSuffix()}; Max-Age=0`;
}

/** Every request rechecks the wallet session and the current database allowlist. */
export async function readOwnerPreviewAuth(): Promise<WalletAuthIdentity | null> {
  try {
    const jar = await cookies();
    const signed = jar.get(ownerPreviewCookieName)?.value;
    if (!signed || signed.length > 2_048) return null;
    const raw = await verifySignedValue(signed, previewSecret());
    if (!raw) return null;
    const token = validateOwnerPreviewToken(JSON.parse(raw));
    if (!token) return null;
    const wallet = await readWalletAuth();
    if (!wallet || wallet.sessionId !== token.sessionId || wallet.walletAddressUniqueKey !== token.walletAddressKey) return null;
    if (!(await isAuthorizedOwnerWallet(wallet.walletAddress))) return null;
    return wallet;
  } catch {
    return null;
  }
}
