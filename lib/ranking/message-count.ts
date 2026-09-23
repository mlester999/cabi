import "server-only";

import { getServiceClient } from "@/lib/db/supabase";

/**
 * Total messages this wallet has sent.
 *
 * `messages` has no `wallet_account_id` column - ownership lives on
 * `conversations` - so the count has to be derived through the conversation.
 * Counting directly on `messages` silently returns zero, which is exactly the
 * sort of bug that makes a lifetime stat quietly wrong rather than obviously
 * broken.
 */
export async function countWalletMessages(walletAccountId: string, role: "user" | "assistant" = "user") {
  const db = getServiceClient();
  if (!db) return 0;
  const { data: conversations } = await db
    .from("conversations")
    .select("id")
    .eq("wallet_account_id", walletAccountId);
  const ids = ((conversations ?? []) as Array<{ id: string }>).map((row) => String(row.id));
  if (ids.length === 0) return 0;
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .eq("role", role);
  return count ?? 0;
}