import "server-only";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/config/env";
import { signValue, verifySignedValue } from "@/lib/security/crypto";

export const adminCookieName = "cabi_admin";

function sessionSecret() {
  const secret = env("SESSION_SECRET") ?? env("APP_ENCRYPTION_KEY");
  if (!secret) {
    if (isProduction()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
    return "cabi-development-session-secret-change-me";
  }
  return secret;
}

export async function createAdminToken(email: string, ttlSeconds = 60 * 60 * 8) {
  const payload = JSON.stringify({ email: email.toLowerCase(), expiresAt: Date.now() + ttlSeconds * 1000, nonce: crypto.randomUUID() });
  return signValue(payload, sessionSecret());
}

export async function readAdminSession() {
  const jar = await cookies();
  const token = jar.get(adminCookieName)?.value;
  if (!token) return null;
  const raw = await verifySignedValue(token, sessionSecret());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email?: unknown; expiresAt?: unknown };
    if (typeof parsed.email !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) return null;
    if (parsed.email.toLowerCase() !== env("ADMIN_EMAIL")?.toLowerCase()) return null;
    return { email: parsed.email, expiresAt: parsed.expiresAt };
  } catch { return null; }
}

export const secureCookie = { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/" };
