import { ensureProfile } from "@/lib/db/supabase";
import { createGuestToken, guestCookieName, readGuestId, secureCookie } from "@/lib/security/session";

export async function GET() {
  let id = await readGuestId();
  let token: string | undefined;
  if (!id) ({ id, token } = await createGuestToken());
  const databaseReady = await ensureProfile(id).catch(() => false);
  const response = Response.json({ guestId: id, databaseReady, mode: databaseReady ? "persistent" : "preview" }, { headers: { "Cache-Control": "private, no-store" } });
  if (token) response.headers.append("Set-Cookie", `${guestCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookie.secure ? "; Secure" : ""}`);
  return response;
}
