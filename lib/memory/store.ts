import "server-only";
import { getServiceClient } from "@/lib/db/supabase";
import { describeImplicitFact, extractImplicitFact, extractMemoryIntent, normalizeMemoryKey } from "@/lib/memory/extractor";

export async function listMemories(walletAccountId: string, limit = 12) {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db.from("user_memories").select("id,category,content,importance,created_at").eq("wallet_account_id", walletAccountId).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);
  return data ?? [];
}

export async function applyMemoryIntent(walletAccountId: string, sourceMessageId: string | null, message: string) {
  const db = getServiceClient();
  const intent = extractMemoryIntent(message);
  if (!db || intent.type === "none") return intent;
  if (intent.type === "forget") {
    const key = normalizeMemoryKey(intent.query);
    await db.from("user_memories").delete().eq("wallet_account_id", walletAccountId).or(`normalized_key.ilike.%${key.replaceAll(/[,%()]/gu, "")}%,content.ilike.%${intent.query.replaceAll(/[,%()]/gu, "")}%`);
    return intent;
  }
  await db.from("user_memories").upsert({ wallet_account_id: walletAccountId, category: intent.category, content: intent.content, normalized_key: intent.normalizedKey, importance: 0.85, storage_reason: "explicit_request", source_message_id: sourceMessageId }, { onConflict: "wallet_account_id,normalized_key" });
  return intent;
}

/**
 * Stores one implicit fact about the user.
 *
 * Long-term memory is keyed on `wallet_account_id`, never on a conversation, so
 * a fact learned in one chat is available in the next one. That is the whole
 * point of this function.
 *
 * Conflicts are resolved by key: `pet:cat` is a single slot, so "my new cat is
 * Max" replaces "my cat is named Luna" rather than leaving two contradictory
 * facts side by side. The unique constraint on (wallet_account_id,
 * normalized_key) does the work, so a concurrent double-store cannot duplicate.
 */
export async function storeImplicitMemory(walletAccountId: string, sourceMessageId: string | null, message: string) {
  const db = getServiceClient();
  if (!db) return null;
  const fact = extractImplicitFact(message);
  if (!fact) return null;

  const { error } = await db.from("user_memories").upsert({
    wallet_account_id: walletAccountId,
    category: fact.category,
    content: describeImplicitFact(fact.category, fact.content, fact.normalizedKey),
    normalized_key: fact.normalizedKey,
    // Implicit facts are less certain than an explicit "remember this", so they
    // rank below explicit memories and can be superseded by one.
    importance: 0.6,
    storage_reason: "implicit_fact",
    source_message_id: sourceMessageId,
  }, { onConflict: "wallet_account_id,normalized_key" });

  return error ? null : fact;
}

/**
 * Relevance-scoped long-term memory retrieval.
 *
 * Injecting every stored fact into every request is both expensive and noisy,
 * so memories are selected by overlap with the current message: a question about
 * a pet pulls the pet fact. Anything already stored is still available to the
 * memory page and to explicit "what do you remember" questions.
 *
 * When the message carries no usable signal, the most important memories are
 * returned so Cabi still has context.
 */
/**
 * Words carrying no retrieval signal. Without this, a generic word such as "the"
 * scores equally with the subject of the question, and the relevant memory can
 * lose to an unrelated one.
 */
const stopwords = new Set([
  "the", "and", "for", "are", "was", "were", "you", "your", "yours", "his", "her", "hers",
  "its", "our", "ours", "their", "them", "they", "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "did", "does", "doing", "done", "have", "has", "had", "can", "could", "should",
  "would", "will", "shall", "may", "might", "must", "about", "with", "from", "into",
  "tell", "said", "say", "says", "know", "remember", "again", "still", "just", "some",
  "any", "all", "not", "but", "get", "got", "give", "make", "made", "use", "used",
]);

/**
 * Word forms used for matching.
 *
 * A naive comparison misses "cat's" vs "cat" and "dogs" vs "dog", which is
 * exactly the phrasing a person uses when asking about a stored fact. Reducing
 * both sides to a small set of forms (the word, the word without a trailing
 * plural, and a light suffix strip) makes "What is my cat's name?" match
 * "The user's pet: cat" without pulling in a stemming dependency.
 */
function wordForms(value: string): Set<string> {
  const forms = new Set<string>();
  for (const word of value.toLowerCase().split(/[^\p{L}\p{N}]+/gu)) {
    if (word.length < 2) continue;
    forms.add(word);
    if (word.length > 3 && word.endsWith("s")) forms.add(word.slice(0, -1));
    if (word.length > 5 && word.endsWith("es")) forms.add(word.slice(0, -2));
    if (word.length > 4 && word.endsWith("ing")) forms.add(word.slice(0, -3));
    if (word.length > 3 && word.endsWith("ed")) forms.add(word.slice(0, -2));
  }
  return forms;
}
export function selectRelevantMemories<T extends { category: string; content: string }>(
  memories: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const tokens = new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/gu)
      .map((token) => token.replace(/(?:'s|s)$/u, ""))
      .filter((token) => token.length >= 3 && !stopwords.has(token)),
  );
  if (tokens.size === 0) return memories.slice(0, limit);

  // Score on whole words, not substrings. A substring test is actively wrong
  // here: every stored fact reads "The user's ...", so the token "er" from
  // "my cat's name" would match every memory equally and swamp the real signal.
  const scored = memories.map((memory, index) => {
    const words = new Set(wordForms(`${memory.category} ${memory.content}`));
    let score = 0;
    for (const form of [...tokens].flatMap((token) => [...wordForms(token)])) {
      if (words.has(form)) score += 1;
    }
    return { memory, score, index };
  });
  // Stable ordering: relevance first, original order as the tie-break so the
  // same context produces the same prompt every time.
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, limit).map((entry) => entry.memory);
}

export async function clearMemories(walletAccountId: string) {
  const db = getServiceClient();
  if (!db) return false;
  const { error } = await db.from("user_memories").delete().eq("wallet_account_id", walletAccountId);
  if (error) throw new Error("MEMORY_CLEAR_FAILED");
  return true;
}
