import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { conversationPatchSchema } from "@/lib/validation/api";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const { id } = await context.params;
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { data: conversation, error: conversationError } = await db.from("conversations").select("id,title,pinned,created_at,updated_at").eq("id", id).eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle();
  if (conversationError) return jsonError("Cabi couldn't load that chat.", 503, "CONVERSATION_LOAD_FAILED");
  if (!conversation) return jsonError("Conversation not found.", 404, "NOT_FOUND");
  const { data: messages, error: messagesError } = await db.from("messages").select("id,role,content,status,metadata_json,created_at,updated_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500);
  if (messagesError) return jsonError("Cabi couldn't load that chat.", 503, "CONVERSATION_LOAD_FAILED");
  return Response.json({ conversation, messages: messages ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const parsed = conversationPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid conversation update.", 400, "INVALID_INPUT");
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { id } = await context.params;
  const { data, error } = await db.from("conversations").update(parsed.data).eq("id", id).eq("wallet_account_id", auth.identity.walletAccountId).select("id,title,pinned,updated_at").maybeSingle();
  if (error || !data) return jsonError("Conversation not found.", 404, "NOT_FOUND");
  return Response.json({ conversation: data });
}

export async function DELETE(request: Request, context: Context) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { id } = await context.params;
  const { data, error } = await db.from("conversations").delete().eq("id", id).eq("wallet_account_id", auth.identity.walletAccountId).select("id").maybeSingle();
  if (error) return jsonError("Couldn't delete that chat.", 503, "DELETE_FAILED");
  if (!data) return jsonError("Conversation not found.", 404, "NOT_FOUND");
  return new Response(null, { status: 204 });
}
