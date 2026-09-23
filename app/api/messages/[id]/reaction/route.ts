import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";
import { reactionSchema } from "@/lib/validation/api";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId(); if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED"); const parsed = reactionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Invalid reaction.", 400, "INVALID_INPUT");
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED"); const { id } = await params; const { data: message } = await db.from("messages").select("conversation_id,role").eq("id", id).maybeSingle(); if (!message || message.role !== "assistant") return jsonError("Message not found.", 404, "NOT_FOUND"); const { data: conversation } = await db.from("conversations").select("id").eq("id", message.conversation_id).eq("user_id", profileId).maybeSingle(); if (!conversation) return jsonError("Message not found.", 404, "NOT_FOUND");
  if (parsed.data.reaction === "none") await db.from("message_reactions").delete().eq("message_id", id).eq("user_id", profileId); else await db.from("message_reactions").upsert({ message_id: id, user_id: profileId, reaction: parsed.data.reaction }, { onConflict: "message_id,user_id" });
  return Response.json({ reaction: parsed.data.reaction === "none" ? null : parsed.data.reaction });
}
