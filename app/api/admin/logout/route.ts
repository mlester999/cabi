import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { adminCookieName, secureCookie } from "@/lib/security/session";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${adminCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie.secure ? "; Secure" : ""}`);
  return response;
}
