import "server-only";

import { cookies } from "next/headers";

import { env, isProduction } from "@/lib/config/env";
import { signValue, verifySignedValue } from "@/lib/security/crypto";
import { readAdminSession } from "@/lib/security/session";
import { validatePreviewToken, type PreviewToken } from "@/lib/site/preview-rules";

export type { PreviewToken } from "@/lib/site/preview-rules";
export { validatePreviewToken } from "@/lib/site/preview-rules";

/**
 * Admin live-preview opt-in.
 *
 * Holding an admin cookie is not enough to reach gated application APIs: the
 * owner must explicitly open `/preview`, which mints this short-lived signed
 * cookie. That keeps an admin who is browsing the public site as a visitor from
 * silently unlocking unfinished functionality, and it gives the API guards a
 * server-side signal that is independent of any request header or query value.
 */
export const previewCookieName = "cabi_preview";
export const previewTtlSeconds = 60 * 60 * 4;

function previewSecret() {
  const secret = env("SESSION_SECRET") ?? env("APP_ENCRYPTION_KEY");
  if (!secret) {
    if (isProduction()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
    return "cabi-development-session-secret-change-me";
  }
  return secret;
}

export async function createPreviewToken(email: string, ttlSeconds = previewTtlSeconds) {
  const payload = JSON.stringify({ scope: "preview", email: email.toLowerCase(), expiresAt: Date.now() + ttlSeconds * 1_000 });
  return signValue(payload, previewSecret());
}

export async function readPreviewToken(): Promise<PreviewToken | null> {
  const jar = await cookies();
  const token = jar.get(previewCookieName)?.value;
  if (!token) return null;
  try {
    const raw = await verifySignedValue(token, previewSecret());
    if (!raw) return null;
    return validatePreviewToken(JSON.parse(raw), env("ADMIN_EMAIL"));
  } catch {
    return null;
  }
}

/**
 * True only for a signed-in admin that explicitly enabled preview. The admin
 * session check is repeated here so a revoked admin loses preview immediately.
 */
export async function isPreviewActive() {
  const [token, session] = await Promise.all([readPreviewToken(), readAdminSession()]);
  if (!token || !session) return false;
  return token.email.toLowerCase() === session.email.toLowerCase();
}

export const previewCookieOptions = {
  httpOnly: true,
  secure: isProduction(),
  sameSite: "lax" as const,
  path: "/",
};
