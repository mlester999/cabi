import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { reactionSchema } from "@/lib/validation/api";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response; const parsed = reactionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Invalid reaction.", 400, "INVALID_INPUT");
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED"); const { id } = await params; const { data: message } = await db.from("messages").select("conversation_id,role").eq("id", id).maybeSingle(); if (!message || message.role !== "assistant") return jsonError("Message not found.", 404, "NOT_FOUND"); const { data: conversation } = await db.from("conversations").select("id").eq("id", message.conversation_id).eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle(); if (!conversation) return jsonError("Message not found.", 404, "NOT_FOUND");
  const { error } = parsed.data.reaction === "none"
    ? await db.from("message_reactions").delete().eq("message_id", id).eq("wallet_account_id", auth.identity.walletAccountId)
    : await db.from("message_reactions").upsert({ message_id: id, wallet_account_id: auth.identity.walletAccountId, reaction: parsed.data.reaction }, { onConflict: "message_id,wallet_account_id" });
  if (error) return jsonError("Cabi couldn't save that reaction.", 503, "REACTION_SAVE_FAILED");
  return Response.json({ reaction: parsed.data.reaction === "none" ? null : parsed.data.reaction });
}
