import "server-only";
import { getServiceClient } from "@/lib/db/supabase";
import { extractMemoryIntent, normalizeMemoryKey } from "@/lib/memory/extractor";

export async function listMemories(profileId: string, limit = 12) {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db.from("user_memories").select("id,category,content,importance,created_at").eq("user_id", profileId).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);
  return data ?? [];
}

export async function applyMemoryIntent(profileId: string, sourceMessageId: string | null, message: string) {
  const db = getServiceClient();
  const intent = extractMemoryIntent(message);
  if (!db || intent.type === "none") return intent;
  if (intent.type === "forget") {
    const key = normalizeMemoryKey(intent.query);
    await db.from("user_memories").delete().eq("user_id", profileId).or(`normalized_key.ilike.%${key.replaceAll(/[,%()]/gu, "")}%,content.ilike.%${intent.query.replaceAll(/[,%()]/gu, "")}%`);
    return intent;
  }
  await db.from("user_memories").upsert({ user_id: profileId, category: intent.category, content: intent.content, normalized_key: intent.normalizedKey, importance: 0.85, storage_reason: "explicit_request", source_message_id: sourceMessageId }, { onConflict: "user_id,normalized_key" });
  return intent;
}

export async function clearMemories(profileId: string) {
  const db = getServiceClient();
  if (!db) return false;
  const { error } = await db.from("user_memories").delete().eq("user_id", profileId);
  if (error) throw new Error("MEMORY_CLEAR_FAILED");
  return true;
}
