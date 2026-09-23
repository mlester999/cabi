import { conversationTimeGroup, validTimeZone } from "@/lib/conversations/time-group";
import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";
type ConversationRow = { id: string; title: string; pinned: boolean; created_at: string; updated_at: string };

export async function GET(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim().slice(0, 120);
  const timeZone = validTimeZone(url.searchParams.get("tz"));
  const result = search
    ? await db.rpc("search_wallet_conversations", { p_wallet_account_id: auth.identity.walletAccountId, p_query: search, p_limit: 60 })
    : await db.from("conversations").select("id,title,pinned,created_at,updated_at").eq("wallet_account_id", auth.identity.walletAccountId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(60);
  const { data, error } = result;
  if (error) return jsonError("Cabi couldn't load your chats.", 503, "CONVERSATION_LOAD_FAILED");
  const conversations = ((data ?? []) as ConversationRow[]).map((conversation) => ({
    ...conversation,
    group: conversationTimeGroup(String(conversation.updated_at), new Date(), timeZone),
  }));
  return Response.json({ conversations }, { headers: { "Cache-Control": "private, no-store" } });
}
