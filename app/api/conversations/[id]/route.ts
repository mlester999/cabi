import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";
import { conversationPatchSchema } from "@/lib/validation/api";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const { id } = await context.params;
  const db = getServiceClient();
  if (!db) return Response.json({ conversation: null, messages: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const { data: conversation } = await db.from("conversations").select("id,title,pinned,created_at,updated_at").eq("id", id).eq("user_id", profileId).maybeSingle();
  if (!conversation) return jsonError("Conversation not found.", 404, "NOT_FOUND");
  const { data: messages } = await db.from("messages").select("id,role,content,status,metadata_json,created_at,updated_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500);
  return Response.json({ conversation, messages: messages ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const parsed = conversationPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid conversation update.", 400, "INVALID_INPUT");
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { id } = await context.params;
  const { data, error } = await db.from("conversations").update(parsed.data).eq("id", id).eq("user_id", profileId).select("id,title,pinned,updated_at").maybeSingle();
  if (error || !data) return jsonError("Conversation not found.", 404, "NOT_FOUND");
  return Response.json({ conversation: data });
}

export async function DELETE(request: Request, context: Context) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { id } = await context.params;
  const { error } = await db.from("conversations").delete().eq("id", id).eq("user_id", profileId);
  if (error) return jsonError("Couldn't delete that chat.", 503, "DELETE_FAILED");
  return new Response(null, { status: 204 });
}
