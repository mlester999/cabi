import "server-only";
import { isKnowledgeQuestion, searchKnowledge } from "@/lib/knowledge/search";

export async function retrieveRagContext(message: string) {
  if (!isKnowledgeQuestion(message)) return { records: [], sources: [] };
  const results = await searchKnowledge(message, 6);
  const usable = results.filter((result) => result.score > 0.01 || results.length <= 2).slice(0, 5);
  return {
    records: usable.map((result, index) => ({ id: `K${index + 1}`, title: result.title, url: result.url, content: result.content.slice(0, 2800) })),
    sources: [...new Map(usable.map((result) => [result.url, { title: result.title, url: result.url, fetchedAt: result.fetchedAt }])).values()],
  };
}
