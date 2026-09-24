import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { z } from "zod";

const editSchema = z.object({ content: z.string().trim().min(1).max(12_000) });
type Context = { params: Promise<{ id: string }> };

async function ownedMessage(id: string, walletAccountId: string) {
  const db = getServiceClient(); if (!db) return null;
  const { data: message } = await db.from("messages").select("id,conversation_id,role").eq("id", id).maybeSingle(); if (!message) return null;
  const { data: conversation } = await db.from("conversations").select("id").eq("id", message.conversation_id).eq("wallet_account_id", walletAccountId).maybeSingle();
  return conversation ? message : null;
}

export async function PATCH(request: Request, context: Context) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response; const { id } = await context.params; const message = await ownedMessage(id, auth.identity.walletAccountId);
  if (!message || message.role !== "user") return jsonError("Message not found.", 404, "NOT_FOUND"); const parsed = editSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Invalid message.", 400, "INVALID_INPUT");
  const db = getServiceClient()!; const { data, error } = await db.from("messages").update({ content: parsed.data.content, updated_at: new Date().toISOString() }).eq("id", id).eq("conversation_id", message.conversation_id).select("id,content,updated_at").single(); if (error) return jsonError("Couldn't edit that message.", 503, "EDIT_FAILED"); return Response.json({ message: data });
}

export async function DELETE(request: Request, context: Context) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response; const { id } = await context.params; const message = await ownedMessage(id, auth.identity.walletAccountId); if (!message) return jsonError("Message not found.", 404, "NOT_FOUND");
  const db = getServiceClient()!; const { error } = await db.from("messages").delete().eq("id", id).eq("conversation_id", message.conversation_id); if (error) return jsonError("Couldn't delete that message.", 503, "DELETE_FAILED"); return new Response(null, { status: 204 });
}
