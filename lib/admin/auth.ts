import "server-only";
import { readAdminSession } from "@/lib/security/session";

export async function requireAdmin() {
  const session = await readAdminSession();
  if (!session) throw new Error("ADMIN_UNAUTHORIZED");
  return session;
}

export async function adminOrResponse() {
  try { return { session: await requireAdmin(), response: null }; }
  catch { return { session: null, response: Response.json({ error: "Admin sign-in required.", code: "ADMIN_UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "private, no-store" } }) }; }
}
