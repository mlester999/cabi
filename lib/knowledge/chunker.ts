import { hashValue } from "@/lib/security/crypto";

export type KnowledgeChunk = { index: number; content: string; tokenEstimate: number; heading?: string; hash: string };

function estimateTokens(value: string) { return Math.ceil(value.length / 4); }

export async function chunkKnowledgeText(text: string, targetTokens = 650, overlapTokens = 90): Promise<KnowledgeChunk[]> {
  const maxChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const paragraphs = text.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const raw: Array<{ content: string; heading?: string }> = [];
  let current = "";
  let heading: string | undefined;
  for (const paragraph of paragraphs) {
    if (paragraph.length < 100 && !/[.!?]$/u.test(paragraph)) heading = paragraph;
    if (current && current.length + paragraph.length + 2 > maxChars) {
      raw.push({ content: current, heading });
      current = `${current.slice(-overlapChars)}\n\n${paragraph}`.trim();
    } else current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) raw.push({ content: current, heading });
  return Promise.all(raw.map(async (item, index) => ({ index, content: item.content, heading: item.heading, tokenEstimate: estimateTokens(item.content), hash: await hashValue(item.content) })));
}
