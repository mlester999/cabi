import "server-only";
import type { AIMessage } from "@/lib/ai/provider";
import { getServiceClient } from "@/lib/db/supabase";
import { listMemories } from "@/lib/memory/store";

export type ConversationContext = { recent: AIMessage[]; summary: string | null; memories: string[]; nickname: string | null; memoryEnabled: boolean };

export async function getConversationContext(profileId: string, conversationId: string): Promise<ConversationContext> {
  const db = getServiceClient();
  if (!db) return { recent: [], summary: null, memories: [], nickname: null, memoryEnabled: true };
  const [{ data: profile }, { data: settings }, { data: messages }, { data: summary }] = await Promise.all([
    db.from("profiles").select("preferred_name").eq("id", profileId).maybeSingle(),
    db.from("user_settings").select("memory_enabled").eq("user_id", profileId).maybeSingle(),
    db.from("messages").select("role,content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(14),
    db.from("conversation_summaries").select("summary").eq("conversation_id", conversationId).maybeSingle(),
  ]);
  const memoryEnabled = settings?.memory_enabled !== false;
  const memories = memoryEnabled ? await listMemories(profileId, 6) : [];
  return {
    recent: (messages ?? []).reverse().map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    summary: summary?.summary ?? null,
    memories: memories.map((memory) => `${memory.category}: ${memory.content}`),
    nickname: profile?.preferred_name ?? null,
    memoryEnabled,
  };
}
