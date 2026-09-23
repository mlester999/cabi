import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";

export async function DELETE(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId(); if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { error } = await db.rpc("clear_user_data", { p_user_id: profileId });
  if (error) return jsonError("Couldn't clear your data.", 503, "CLEAR_FAILED");
  return new Response(null, { status: 204 });
}
