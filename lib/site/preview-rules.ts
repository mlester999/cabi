/**
 * Pure admin-preview authorization rules.
 *
 * Kept out of `lib/site/preview.ts` (which is `server-only` and reads cookies)
 * so the exact conditions that unlock the unfinished application can be unit
 * tested directly.
 */
export type PreviewToken = { email: string; expiresAt: number };

/**
 * A preview token is valid only when it carries the preview scope, names the
 * currently configured admin, and has not expired. Anything else fails closed.
 */
export function validatePreviewToken(
  decoded: unknown,
  adminEmail: string | undefined,
  now = Date.now(),
): PreviewToken | null {
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  const parsed = decoded as { scope?: unknown; email?: unknown; expiresAt?: unknown };
  if (parsed.scope !== "preview") return null;
  if (typeof parsed.email !== "string" || typeof parsed.expiresAt !== "number") return null;
  if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
  if (!adminEmail || parsed.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
  return { email: parsed.email, expiresAt: parsed.expiresAt };
}

/** The owner must be a signed-in admin *and* have explicitly opted in. */
export function previewIsAuthorized(token: PreviewToken | null, adminEmail: string | undefined, now = Date.now()) {
  if (!token) return false;
  return validatePreviewToken({ scope: "preview", ...token }, adminEmail, now) !== null;
}
