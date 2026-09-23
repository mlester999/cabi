import "server-only";
import { getServiceClient } from "@/lib/db/supabase";

export type KnowledgeResult = { id: string; title: string; url: string; content: string; score: number; fetchedAt?: string };

export async function searchKnowledge(query: string, limit = 6): Promise<KnowledgeResult[]> {
  const db = getServiceClient();
  if (!db || query.trim().length < 2) return [];
  const { data, error } = await db.rpc("search_knowledge_chunks", { p_query: query.slice(0, 500), p_limit: Math.min(limit, 10) });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.chunk_id), title: String(row.title), url: String(row.source_url), content: String(row.content), score: Number(row.score ?? 0), fetchedAt: row.fetched_at ? String(row.fetched_at) : undefined }));
}

export function isKnowledgeQuestion(message: string) {
  return /\b(clank(?:\.trade)?|\$?cpu|cat partner unit|bonding curve|ai coin|robinhood chain|contract address|ticker|trade|buy|sell|slippage|market cap)\b/iu.test(message);
}
