export type MemoryIntent =
  | { type: "remember"; category: string; content: string; normalizedKey: string }
  | { type: "forget"; query: string }
  | { type: "none" };

const sensitive = /\b(password|passcode|private key|seed phrase|recovery phrase|social security|ssn|bank account|credit card|medical diagnosis|home address|passport|driver'?s license)\b/iu;

function categoryFor(content: string) {
  if (/\b(call me|my name is|nickname)\b/iu.test(content)) return "identity";
  if (/\b(i like|i love|favorite|prefer|don't like|hate)\b/iu.test(content)) return "preference";
  if (/\b(project|building|working on|goal)\b/iu.test(content)) return "project";
  if (/\b(communicate|responses?|concise|detailed|tone)\b/iu.test(content)) return "communication";
  return "general";
}

export function normalizeMemoryKey(content: string) {
  return content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160);
}

export function extractMemoryIntent(message: string): MemoryIntent {
  const trimmed = message.trim();
  const forget = trimmed.match(/^(?:please\s+)?forget\s+(?:that\s+)?(.{2,500})$/iu);
  if (forget) return { type: "forget", query: forget[1].trim() };
  const remember = trimmed.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.{2,800})$/iu);
  if (!remember) return { type: "none" };
  const content = remember[1].trim();
  if (sensitive.test(content) || /\b(?:[a-z]+\s+){11,23}[a-z]+\b/iu.test(content)) return { type: "none" };
  return { type: "remember", category: categoryFor(content), content, normalizedKey: normalizeMemoryKey(content) };
}

export function isSensitiveMemory(content: string) { return sensitive.test(content); }

/* ---------------------------------------------------------------------------
 * Implicit fact extraction.
 *
 * The explicit `remember ...` path above only captures facts a user deliberately
 * asks Cabi to keep. Cross-chat memory also needs facts people state in passing
 * - "my cat is named Luna" - or a new conversation can never answer "what is my
 * cat's name?".
 *
 * This extractor is deliberately narrow. It is an allowlist of clear, useful,
 * low-risk statement shapes, not a general fact finder:
 *
 * - only first-person statements, so Cabi never stores something about someone
 *   else that the user merely mentioned;
 * - only a fixed set of durable categories (name, pet, location, work, hobby,
 *   preference, goal, birthday);
 * - anything matching the sensitive list is rejected outright;
 * - questions are never stored, because "what is my cat's name?" must not
 *   overwrite "my cat is named Luna".
 * ------------------------------------------------------------------------- */

/** Durable, useful categories worth remembering across conversations. */
export type ImplicitCategory = "identity" | "pet" | "location" | "work" | "hobby" | "preference" | "goal" | "date";

export type ImplicitFact = { category: ImplicitCategory; content: string; normalizedKey: string };

/** Interrogatives and hypotheticals that are never durable facts. */
const notAFact = /(\?|\b(?:did|do|does|would|could|should|can|what|which|who|when|where|why|how|if|maybe|might|wonder)\b)/iu;

/** Statement shapes Cabi may remember. Each captures the whole clause. */
const factPatterns: ReadonlyArray<{ category: ImplicitCategory; pattern: RegExp }> = [
  // Pets. The possessive and an optional modifier are both tolerated, because
  // "my cat", "my new cat", "our cat" and "my cat's name" all describe the same
  // slot and must key to `pet:cat`.
  { category: "pet", pattern: /\b(?:my|our)\s+(?:new\s+|little\s+|old\s+)?(cat|dog|kitten|puppy|pet|bird|hamster|rabbit|fish)\b[^.!?]{0,40}?\b(?:is|are)\s+(?:called|named)\s+([^.!?,;]{1,40})/iu },
  { category: "pet", pattern: /\b(?:my|our)\s+(?:new\s+|little\s+|old\s+)?(cat|dog|kitten|puppy|pet|bird|hamster|rabbit|fish)(?:'s)?\s+name\s+is\s+([^.!?,;]{1,40})/iu },
  // "my new cat is Max" - a bare "is" with a capitalised name. The capital is
  // required so "my cat is sleeping" is not stored as a pet called "sleeping".
  { category: "pet", pattern: /\b(?:my|our)\s+(?:new\s+|little\s+|old\s+)?(cat|dog|kitten|puppy|pet|bird|hamster|rabbit|fish)\b[^.!?]{0,20}?\s\bis\s+([A-Z][\p{L}'-]{1,30})\b/iu },
  // The user's own name, when stated rather than asked for.
  { category: "identity", pattern: /\b(?:my name is|i am called|call me|i go by)\s+([^.!?,;]{2,40})/iu },
  // Location: "I live in Berlin", "I'm based in Osaka"
  { category: "location", pattern: /\bi\s+(?:live|am based|stay)\s+in\s+([^.!?,;]{2,50})/iu },
  // Work and study
  { category: "work", pattern: /\bi\s+(?:work|am working)\s+(?:as|at|for|on)\s+([^.!?,;]{2,60})/iu },
  { category: "work", pattern: /\bi\s+(?:study|am studying)\s+([^.!?,;]{2,60})/iu },
  // Hobbies and interests
  { category: "hobby", pattern: /\bi\s+(?:play|practice)\s+([^.!?,;]{2,50})/iu },
  { category: "hobby", pattern: /\bmy\s+hobb(?:y|ies)\s+(?:is|are)\s+([^.!?,;]{2,60})/iu },
  // Preferences
  { category: "preference", pattern: /\bmy\s+favou?rite\s+([a-z ]{2,30})\s+is\s+([^.!?,;]{1,60})/iu },
  { category: "preference", pattern: /\bi\s+(?:really\s+)?(?:like|love|enjoy|prefer)\s+([^.!?,;]{3,60})/iu },
  // Goals
  { category: "goal", pattern: /\bi\s+(?:want|plan|hope|intend)\s+to\s+([^.!?,;]{3,80})/iu },
  { category: "goal", pattern: /\bi\s+am\s+(?:building|working on)\s+([^.!?,;]{3,80})/iu },
  // Durable dates
  { category: "date", pattern: /\bmy\s+birthday\s+is\s+([^.!?,;]{2,40})/iu },
];

/** Cleanup that keeps a stored fact readable and bounded. */
function tidyFact(value: string) {
  return value
    .replace(/\s+/gu, " ")
    .replace(/^[\s,;:.-]+/u, "")
    .replace(/[\s,;:.-]+$/u, "")
    .trim()
    .slice(0, 200);
}

/**
 * A stable identity key for a fact so a later statement can supersede it.
 *
 * "my cat is named Luna" then "my new cat is Max" both key to `pet:cat`, so the
 * second replaces the first instead of leaving two contradictory facts.
 */
export function implicitFactKey(category: ImplicitCategory, content: string): string {
  const lower = content.toLowerCase();
  if (category === "pet") {
    for (const animal of ["cat", "dog", "kitten", "puppy", "pet", "bird", "hamster", "rabbit", "fish"]) {
      // Word-boundary match so "cat" is found in "my new cat is Max" but not
      // inside an unrelated word.
      if (new RegExp(`\\b${animal}\\b`, "u").test(lower)) return `pet:${animal}`;
    }
    return "pet";
  }
  if (category === "identity") return "identity:name";
  if (category === "location") return "location:home";
  if (category === "preference") {
    // Key by what the preference is about, so "favourite game" updates in place
    // without clobbering "favourite food". The subject is captured explicitly
    // rather than inferred, because "my favourite food is ramen" and
    // "I love ramen" describe the same slot.
    const named = lower.match(/favou?rite\s+([a-z ]{2,30}?)\s+is\b/u)?.[1];
    if (named) return `preference:${named.trim()}`;
    const liked = lower.match(/\bi\s+(?:really\s+)?(?:like|love|enjoy|prefer)\s+(.{3,60})$/u)?.[1];
    return liked ? `preference:${liked.trim().replace(/\s+/gu, " ").slice(0, 40)}` : "preference";
  }
  if (category === "goal") return "goal:current";
  if (category === "date") return "date:birthday";
  return category;
}

/**
 * Extracts at most one durable fact from a message.
 *
 * Returns null far more often than not, which is the point: most messages are
 * conversation, not facts.
 */
export function extractImplicitFact(message: string): ImplicitFact | null {
  const trimmed = message.trim();
  if (trimmed.length < 8 || trimmed.length > 500) return null;
  if (notAFact.test(trimmed)) return null;
  if (sensitive.test(trimmed)) return null;
  // Only the user's own statements. "My friend's cat is named Luna" is not
  // something Cabi should attribute to the user.
  if (/\b(my (?:friend|brother|sister|mother|father|mum|dad|partner|colleague|coworker|boss)'?s?)\b/iu.test(trimmed)) return null;

  for (const { category, pattern } of factPatterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    // The value is the last capture; earlier captures are subject hints such as
    // the pet animal, which the key needs.
    const captured = match.slice(1).filter(Boolean).at(-1);
    if (!captured) continue;
    const content = tidyFact(captured);
    if (content.length < 2) continue;
    // A captured value that is only filler is not a fact.
    if (/^(?:a|an|the|it|that|this|something|stuff|things?)$/iu.test(content)) continue;
    const full = tidyFact(match[0]);
    return { category, content, normalizedKey: implicitFactKey(category, full) };
  }
  return null;
}

/**
 * Rewrites a stored fact into a readable sentence for prompt context, so Cabi
 * sees "pet: Luna" as "Your cat is named Luna" rather than a bare value.
 */
export function describeImplicitFact(category: ImplicitCategory, content: string, normalizedKey = ""): string {
  // The subject is included in the stored sentence. Without it, "pet:cat -> Luna"
  // would be stored as "The user's pet: Luna", and a later question about a cat
  // would have nothing to match on: the word "cat" would exist only in the key.
  const subject = normalizedKey.includes(":") ? normalizedKey.split(":")[1] : "";
  switch (category) {
    case "pet": return subject ? `The user's ${subject} is named ${content}` : `The user's pet is named ${content}`;
    case "identity": return `The user's name is ${content}`;
    case "location": return `The user lives in ${content}`;
    case "work": return `The user's work or study: ${content}`;
    case "hobby": return `The user's hobby is ${content}`;
    case "preference": return subject ? `The user's favourite ${subject} is ${content}` : `The user's preference: ${content}`;
    case "goal": return `The user wants to ${content}`;
    case "date": return `The user's ${subject || "date"}: ${content}`;
    default: return `The user mentioned: ${content}`;
  }
}