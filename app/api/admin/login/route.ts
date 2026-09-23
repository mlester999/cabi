import { env } from "@/lib/config/env";
import { clientAddress, assertSameOrigin, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { adminCookieName, createAdminToken, secureCookie } from "@/lib/security/session";
import { verifyPbkdf2Password } from "@/lib/security/crypto";
import { adminLoginSchema } from "@/lib/validation/api";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const limited = await checkRateLimit("admin.login", clientAddress(request), 6, 15 * 60);
  if (!limited.allowed) return new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limited.retryAfter) } });
  const parsed = adminLoginSchema.safeParse(await request.json().catch(() => null));
  const email = env("ADMIN_EMAIL"); const passwordHash = env("ADMIN_PASSWORD_HASH");
  if (!email || !passwordHash) return jsonError("Admin access hasn't been configured yet.", 503, "ADMIN_NOT_CONFIGURED");
  const valid = parsed.success && parsed.data.email.toLowerCase() === email.toLowerCase() && await verifyPbkdf2Password(parsed.data.password, passwordHash);
  if (!valid) return jsonError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");
  const token = await createAdminToken(email);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${adminCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secureCookie.secure ? "; Secure" : ""}`);
  return response;
}
