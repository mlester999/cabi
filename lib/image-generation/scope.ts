/**
 * Cabi-only image scope enforcement.
 *
 * This generator is not a general-purpose image tool. It exists to draw Cabi.
 * The rule is enforced deterministically on the server before any provider call,
 * so a request cannot reach a paid API without passing it.
 *
 * The behaviour is deliberately *redirective* rather than punitive:
 *
 *   "Generate a Lamborghini"        -> refused, offered "Cabi with a Lamborghini"
 *   "Cabi beside a Lamborghini"     -> allowed
 *
 * That keeps the product on-message without making the user feel blocked.
 */

/** Words that mean "this request is about Cabi". */
const cabiMarkers: readonly RegExp[] = [
  /\bcabi\b/iu,
  /\bc\.?p\.?u\.?\b/iu,
  /\bcat ?girl\b/iu,
  /\bcat ?partner\b/iu,
  /\byourself\b/iu,
  /\byou\b/iu,
  /\byour\b/iu,
  /\bher\b/iu,
  /\bshe\b/iu,
  /\bselfie\b/iu,
];

/**
 * Verbs and framings that make a request about the character even when the
 * subject is something else: "you at the beach", "Cabi wearing a hoodie".
 */
const characterFramings: readonly RegExp[] = [
  /\b(wearing|in a|in an|dressed|outfit|cosplay)\b/iu,
  /\b(at the|on the|in the|beside|next to|with|holding|near)\b/iu,
  /\b(portrait|avatar|wallpaper|selfie|reaction|drawing|illustration|art)\b/iu,
];

/**
 * Topics that are never allowed regardless of framing. Kept short and
 * unambiguous: this is a safety list, not a taste filter.
 */
const blockedContent: readonly RegExp[] = [
  /\b(nude|naked|nsfw|explicit|sexual|porn|erotic)\b/iu,
  /\b(gore|guro|dismember|behead|torture|snuff)\b/iu,
  /\b(nazi|swastika|terrorist|beheading)\b/iu,
  /\b(child|minor|underage|loli|shota)\b/iu,
  /\b(seed phrase|private key|mnemonic|recovery phrase)\b/iu,
];

export type ImageScopeDecision =
  | { allowed: true; scene: string }
  | { allowed: false; reason: "BLOCKED_CONTENT"; message: string }
  | { allowed: false; reason: "OFF_TOPIC"; message: string; suggestion: string };

/** Trims a request down to the scene description, dropping the instruction verb. */
export function extractScene(prompt: string): string {
  return prompt
    .trim()
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:generate|make|create|draw|show me|give me|render|paint)\s+/iu, "")
    .replace(/^(?:an?|the)\s+(?:image|picture|photo|drawing|illustration|artwork)\s+(?:of\s+)?/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 400);
}

/**
 * Decides whether a prompt may reach the provider.
 *
 * A request is in scope when it names Cabi (or addresses her directly) OR when
 * it frames a subject as something Cabi is doing, wearing, or standing next to.
 */
export function checkImageScope(prompt: string): ImageScopeDecision {
  const scene = extractScene(prompt);

  if (blockedContent.some((pattern) => pattern.test(scene))) {
    return { allowed: false, reason: "BLOCKED_CONTENT", message: "I am not going to draw that one." };
  }

  if (!scene) {
    return {
      allowed: false,
      reason: "OFF_TOPIC",
      message: "Tell me what you would like me to be doing and I will draw it.",
      suggestion: "Cabi waving hello",
    };
  }

  const namesCabi = cabiMarkers.some((pattern) => pattern.test(scene));
  const framedAsCharacter = characterFramings.some((pattern) => pattern.test(scene));

  // "Cabi at the beach" - explicitly about her.
  if (namesCabi) return { allowed: true, scene };

  // "a hoodie" is off-topic; "you wearing a hoodie" is already caught above by
  // the "you"/"your" marker. This branch handles framings with no pronoun.
  if (framedAsCharacter && /\b(cabi|you|your|her|she)\b/iu.test(scene)) return { allowed: true, scene };

  // Off-topic. Offer the Cabi version of the same idea rather than a flat no.
  return {
    allowed: false,
    reason: "OFF_TOPIC",
    message: "I only make Cabi-related images.",
    suggestion: `Cabi ${lowerFirst(scene)}`,
  };
}

function lowerFirst(value: string) {
  const trimmed = value.replace(/^(?:an?|the)\s+/iu, "").trim();
  if (!trimmed) return "waving hello";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Does this prompt look like an image request at all?
 *
 * Used by the chat action layer to decide whether to route a message to the
 * image pipeline before it reaches the model.
 */
export function looksLikeImageRequest(message: string): boolean {
  const text = message.trim();
  if (text.length < 6 || text.length > 600) return false;

  // An explicit slash command is unambiguous.
  if (/^\/(?:image|img|draw)\b/iu.test(text)) return true;

  // "draw", "render", "paint" and "generate" are almost never used about
  // anything except a picture, so they are treated as a drawing intent on their
  // own - unless the object is plainly textual, which the exclusion below
  // handles. This is what lets "Generate a Lamborghini" reach the scope guard so
  // Cabi can redirect it, rather than being answered as ordinary conversation.
  const drawingVerb = /\b(draw|render|paint|generate)\b/iu.test(text);

  // Otherwise a picture request is a generation verb plus either an image noun
  // or Cabi herself. Requiring one of the two is what keeps ordinary
  // conversation out: "make a list" and "show me the price" are not requests.
  //
  // The earlier version required the noun to sit within a short window after the
  // verb, which silently missed the most natural phrasings of all -
  // "Generate Cabi on top of a skyscraper", "Make Cabi in a cyberpunk city".
  const GENERATE = String.raw`\b(?:generate|make|create|show|give|send)\b`;
  const IMAGE_NOUN = String.raw`\b(?:image|images|picture|pictures|pic|photo|photos|drawing|illustration|art|artwork|selfie|wallpaper|avatar|portrait|render)\b`;
  const CABI = String.raw`\b(?:cabi|yourself|you|your|cat ?girl)\b`;

  // Text and code artefacts. "generate a summary" and "create a table" are
  // ordinary product questions, not picture requests, and must not be diverted
  // into the image pipeline.
  const NOT_VISUAL = String.raw`\b(?:summary|list|table|plan|code|function|component|schema|query|sql|sentence|paragraph|email|essay|poem|story|joke|reply|response|answer|explanation|translation|report|breakdown|outline|steps|example|test|regex|typescript|json|markdown)\b`;

  // A generation verb plus either an image noun or Cabi.
  const candidate = drawingVerb
    || new RegExp(`${GENERATE}[^.!?]{0,60}(?:${IMAGE_NOUN}|${CABI})`, "iu").test(text);
  if (!candidate) return false;
  // Never divert a plainly textual request ("generate a summary", "make a list").
  if (new RegExp(`(?:${GENERATE}|draw|render|paint)[^.!?]{0,20}${NOT_VISUAL}`, "iu").test(text)) return false;
  return true;
}
/* ---------------------------------------------------------------------------
 * Relevance classification with conversation context.
 *
 * A literal search for the word "Cabi" is not enough. After a turn about her, a
 * person naturally says "put her in a gaming chair" and expects that to work.
 * The classifier therefore has three outcomes:
 *
 *   CABI_RELATED      - generate
 *   NOT_CABI_RELATED  - refuse, and offer the Cabi version
 *   UNCERTAIN         - ask what they want involving her, then generate
 *
 * It is pure, synchronous and free: no model call runs before this, so a refused
 * request never spends a provider credit.
 * ------------------------------------------------------------------------- */

export type RelevanceVerdict = "CABI_RELATED" | "NOT_CABI_RELATED" | "UNCERTAIN";

/** Pronouns that refer back to Cabi only when she has just been discussed. */
const backReferences = /\b(?:her|she|hers|herself)\b/iu;

/** Context-free pronouns: "you" always means Cabi in this product. */
const directAddress = /\b(?:you|your|yours|yourself|u)\b/iu;

/** Subjects that are plainly their own thing, not a Cabi scene. */
const standaloneSubjects = [
  /\b(?:cristiano ronaldo|messi|elon musk|taylor swift|donald trump|beyonce)\b/iu,
  /\b(?:a|an|the)?\s*(?:random\s+)?(?:landscape|scenery|sunset|mountains?|forest|beach)\s*$/iu,
  /\b(?:bitcoin|ethereum|solana|doge)\s+(?:logo|coin|chart)\b/iu,
  /\b(?:a|an|the)\s+(?:dog|cat|puppy|kitten|horse|bird)\s*$/iu,
  /\b(?:lamborghini|ferrari|porsche|tesla|bmw|sports car|supercar)\s*$/iu,
  /\b(?:anime girlfriend|waifu)\b/iu,
];

/**
 * Classifies a request.
 *
 * `conversationContext` is the recent transcript, most recent last. It is used
 * only to decide whether a back-reference resolves to Cabi; it can never make an
 * unrelated subject relevant on its own.
 */
export function classifyCabiRelevance(prompt: string, conversationContext: readonly string[] = []): RelevanceVerdict {
  const scene = extractScene(prompt);
  if (!scene) return "UNCERTAIN";

  // An explicit mention always settles it.
  if (cabiMarkers.some((pattern) => pattern.test(scene))) return "CABI_RELATED";

  // Direct address ("you in a hoodie") always means her.
  if (directAddress.test(scene)) return "CABI_RELATED";

  const mentionsCabiRecently = conversationContext
    .slice(-6)
    .some((turn) => cabiMarkers.some((pattern) => pattern.test(turn)));

  // A back-reference with no recent mention of Cabi is genuinely ambiguous: "put
  // her in a chair" could be about anyone, so we ask rather than guess.
  if (backReferences.test(scene)) return mentionsCabiRecently ? "CABI_RELATED" : "UNCERTAIN";

  // "make a picture of a Lamborghini" - its own subject, no Cabi anywhere.
  if (standaloneSubjects.some((pattern) => pattern.test(scene))) return "NOT_CABI_RELATED";

  // "Cabi riding in a Lamborghini" is already CABI_RELATED above, so reaching
  // here with a bare object means no Cabi connection.
  const framedAsCharacter = characterFramings.some((pattern) => pattern.test(scene));
  if (framedAsCharacter) return "UNCERTAIN";

  return "NOT_CABI_RELATED";
}

/**
 * Natural refusals for an unrelated request.
 *
 * Several variants so Cabi does not repeat one sentence, chosen deterministically
 * from the prompt so the same request gives the same reply (which keeps tests and
 * behaviour stable) while different requests vary.
 */
const offTopicReplies: readonly string[] = [
  "That one's not really about me. Give me something with Cabi in it and I'll make it for you.",
  "I only draw myself, hehe. Want me to make one of me doing that?",
  "Hmm, that is not very Cabi. Tell me what I am doing in it and I am on it.",
  "I am a one-character studio. Say the word and I will put myself in that scene.",
  "That one is not about me! Ask for me instead and I will draw it.",
];

const uncertainReplies: readonly string[] = [
  "Wait, who am I drawing? Tell me what I am doing and I will make it.",
  "I want to make sure it is me in the picture. What am I doing?",
  "Hmm, is this about me? Say what I am up to and I will draw it.",
];

/** Stable pick: the same prompt always yields the same variant. */
function pickVariant(variants: readonly string[], seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return variants[hash % variants.length];
}

export function offTopicReply(prompt: string): string {
  return pickVariant(offTopicReplies, prompt);
}

export function uncertainReply(prompt: string): string {
  return pickVariant(uncertainReplies, prompt);
}