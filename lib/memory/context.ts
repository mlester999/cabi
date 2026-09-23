import "server-only";
import type { AIMessage } from "@/lib/ai/provider";
import { getServiceClient } from "@/lib/db/supabase";
import { listMemories, selectRelevantMemories } from "@/lib/memory/store";

export type ConversationContext = { recent: AIMessage[]; summary: string | null; memories: string[]; nickname: string | null; memoryEnabled: boolean };

/**
 * Assembles the three memory layers for one turn.
 *
 * 1. **Short term** - recent completed messages from this conversation.
 * 2. **Conversation summary** - older context from this conversation.
 * 3. **Long term** - persistent facts scoped to `wallet_account_id`, so a fact
 *    stored in one conversation is available in every other one.
 *
 * Long-term memories are selected for *relevance to the current message* rather
 * than injected wholesale, so a question about a pet pulls the pet fact. When
 * memory is switched off, neither layer 2 nor layer 3 is used and the caller
 * stops writing new long-term memories.
 */
export async function getConversationContext(walletAccountId: string, profileId: string, conversationId: string, query = ""): Promise<ConversationContext> {
  const db = getServiceClient();
  if (!db) return { recent: [], summary: null, memories: [], nickname: null, memoryEnabled: true };
  const [{ data: profile }, { data: settings }, { data: messages }, { data: summary }] = await Promise.all([
    db.from("profiles").select("preferred_name").eq("id", profileId).maybeSingle(),
    db.from("user_settings").select("memory_enabled").eq("wallet_account_id", walletAccountId).maybeSingle(),
    db.from("messages").select("role,content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).eq("status", "complete").neq("content", "").order("created_at", { ascending: false }).limit(14),
    db.from("conversation_summaries").select("summary").eq("conversation_id", conversationId).maybeSingle(),
  ]);
  const memoryEnabled = settings?.memory_enabled !== false;
  // Fetch a wider pool than we inject, then narrow it by relevance.
  const stored = memoryEnabled ? await listMemories(walletAccountId, 40) : [];
  const relevant = memoryEnabled ? selectRelevantMemories(stored, query, 8) : [];
  return {
    recent: (messages ?? []).reverse().map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    summary: memoryEnabled ? summary?.summary ?? null : null,
    memories: relevant.map((memory) => `${memory.category}: ${memory.content}`),
    nickname: profile?.preferred_name ?? null,
    memoryEnabled,
  };
}
