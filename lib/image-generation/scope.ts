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
  // Every entry is word-bounded. An unanchored `cabi` matched the middle of
  // "gaming", which made "put her in a gaming chair" look like an explicit Cabi
  // request.
  /\bcabi\b/iu,
  /\bcpu\b/iu,
  /\bcat\s?girl\b/iu,
  /\bcat\s?partner\b/iu,
  /\byourself\b/iu,
  /\byou\b/iu,
  /\byour\b/iu,
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
    // A bare article is left behind by the verb strip above ("make a picture of
    // a Lamborghini" leaves "a Lamborghini"), and a leading article defeats the
    // standalone-subject patterns, which anchor on the noun itself.
    .replace(/^(?:an?|the)\s+/iu, "")
    // A bare image noun left alone means no subject was given: "generate an
    // image" reduces to "image", which is not a scene. Without this the request
    // would be refused as unrelated instead of asking what to draw.
    .replace(/^(?:image|images|picture|pictures|pic|photo|photos|drawing|illustration|artwork|render)\b\s*/iu, "")
    .replace(/\s+/gu, " ")
    // Trailing punctuation would defeat the anchored subject patterns, so
    // "Generate a Lamborghini." and "a Lamborghini" resolve the same way.
    .replace(/[\s.,;:!?]+$/gu, "")
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
  // "logo", "poster", "banner" and similar are visual artefacts even though they
  // are not photographs. "Create a Bitcoin logo" should reach the relevance
  // classifier so Cabi can redirect it, rather than being answered as prose.
  const IMAGE_NOUN = String.raw`\b(?:image|images|picture|pictures|pic|photo|photos|drawing|illustration|art|artwork|selfie|wallpaper|avatar|portrait|render|logo|poster|banner|icon|sticker|meme|wallpapers)\b`;
  const CABI = String.raw`\b(?:cabi|yourself|you|your|cat ?girl)\b`;

  // Text and code artefacts. "generate a summary" and "create a table" are
  // ordinary product questions, not picture requests, and must not be diverted
  // into the image pipeline.
  const NOT_VISUAL = String.raw`\b(?:summary|list|table|plan|code|function|component|schema|query|sql|sentence|paragraph|email|essay|poem|story|joke|reply|response|answer|explanation|translation|report|breakdown|outline|steps|example|test|regex|typescript|json|markdown)\b`;

  /*
   * A bare scene with no verb is still a request when it names a depicted
   * subject. The brief's own examples include "Cabi playing on a gaming PC" and
   * "Cabi wearing a purple CPU hoodie" — no "generate", no image noun — because
   * that is how a person talks to a companion they are already in conversation
   * with. Requirement: the message must name Cabi, so ordinary chat about her
   * ("Cabi is helpful") does not become a drawing.
   */
  const DEPICTION = String.raw`\b(?:playing|wearing|holding|sitting|standing|sleeping|eating|drinking|reading|coding|working|celebrating|riding|hugging|painting|cooking|walking|smiling|waving|dancing|singing|in|on|at|as|beside|next to|with)\b`;
  const CABI_NAME = String.raw`\b(?:cabi|cpu|cat ?girl|cat ?partner)\b`;
  const bareDepiction = new RegExp(`${CABI_NAME}[^.!?]{0,60}${DEPICTION}`, "iu").test(text)
    || new RegExp(`${DEPICTION}[^.!?]{0,40}${CABI_NAME}`, "iu").test(text);

  /*
   * A generation verb aimed at a scene-type noun. "Make a random landscape" and
   * "create a cityscape" are picture requests with no Cabi in them, so they must
   * reach the relevance classifier to be redirected rather than answered as
   * ordinary conversation.
   */
  const SCENE_NOUN = String.raw`\b(?:landscape|scenery|scene|cityscape|skyline|portrait|sunset|sunrise|mountains?|forest|ocean|beach|street|room|background)\b`;
  const sceneRequest = new RegExp(`${GENERATE}[^.!?]{0,40}${SCENE_NOUN}`, "iu").test(text);

  /*
   * A directorial verb aimed at a pronoun: "put her in a gaming chair", "make
   * her a wallpaper". These are image requests even with no generation verb and
   * no image noun, which is exactly the phrasing the brief calls out. Whether
   * "her" means Cabi is decided later by the relevance classifier using
   * conversation context, so an unresolved pronoun becomes an UNCERTAIN ask
   * rather than a refusal.
   */
  const DIRECT = String.raw`\b(?:put|place|show|draw|render|make|create|give|paint)\b`;
  const PRONOUN = String.raw`\b(?:her|she|herself|you|yourself)\b`;
  const directorialRequest = new RegExp(`${DIRECT}[^.!?]{0,30}${PRONOUN}`, "iu").test(text)
    || new RegExp(`${PRONOUN}[^.!?]{0,20}${DEPICTION}`, "iu").test(text);

  // A generation verb plus either an image noun or Cabi.
  const candidate = drawingVerb || bareDepiction || sceneRequest || directorialRequest
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

/**
 * Subjects that are plainly their own thing, not a Cabi scene.
 *
 * Matched against the extracted scene, which has already had the instruction
 * verb and a leading article removed, so these anchor on the bare noun.
 */
const standaloneSubjects = [
  /\b(?:cristiano ronaldo|messi|elon musk|taylor swift|donald trump|beyonce)\b/iu,
  /\b(?:random\s+)?(?:landscape|scenery|sunset|mountains?|forest)\b/iu,
  /\b(?:bitcoin|ethereum|solana|doge)\s+(?:logo|coin|chart)\b/iu,
  /\b(?:dog|cat|puppy|kitten|horse|bird)\b\s*$/iu,
  /\b(?:lamborghini|ferrari|porsche|tesla|bmw|sports car|supercar)\b/iu,
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

  // An explicit mention settles it, and must be checked BEFORE the length guard:
  // a short scene such as "yourself gaming" or "Cabi waving" is unambiguous.
  if (scene && cabiMarkers.some((pattern) => pattern.test(scene))) return "CABI_RELATED";

  // Direct address ("you in a hoodie") always means her.
  if (scene && directAddress.test(scene)) return "CABI_RELATED";

  /*
   * Nothing usable to draw. Only a genuinely empty scene is ambiguous; a single
   * word is not. "Lamborghini" is a perfectly good standalone subject that must
   * be refused as unrelated, so it must reach the subject check below rather than
   * the ask-branch. Only "generate an image" with no subject lands here.
   */
  if (!scene) return "UNCERTAIN";

  const mentionsCabiRecently = conversationContext
    .slice(-6)
    .some((turn) => cabiMarkers.some((pattern) => pattern.test(turn)));

  // A back-reference with no recent mention of Cabi is genuinely ambiguous: "put
  // her in a chair" could be about anyone, so we ask rather than guess.
  if (backReferences.test(scene)) return mentionsCabiRecently ? "CABI_RELATED" : "UNCERTAIN";

  /*
   * A modification of the active image subject. Checked BEFORE the standalone
   * refusal, because "another one but at sunset" is not its own subject: it
   * refers back to whatever the conversation was already about.
   */
  if (looksLikeImageFollowUp(prompt)) {
    return conversationHasCabiSubject(conversationContext) ? "CABI_RELATED" : "UNCERTAIN";
  }

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
/**
 * Follow-up modifiers.
 *
 * "Make another one but at sunset" contains no Cabi marker at all — it modifies
 * the image that is already the subject of the conversation. Without this,
 * exactly the follow-up the brief calls out is refused as unrelated.
 *
 * A bare modifier is only meaningful WITH Cabi-image context. Without it the
 * request is ambiguous ("another one" of what?), so it asks rather than guessing.
 */
const followUpModifiers: readonly RegExp[] = [
  /\banother\s+(?:one|image|picture|photo)\b/iu,
  /\bone\s+more\s+(?:time|image|picture)?\b/iu,
  /\bsame\s+(?:one|thing|but|idea)\b/iu,
  /\b(?:but|now)\s+(?:with|at|in|on|during|wearing|holding|doing)\b/iu,
  /\b(?:make|do|try)\s+(?:it|that)\s+(?:again|but|with)\b/iu,
  /\b(?:change|adjust|modify|update)\s+(?:it|that|the\s+(?:image|picture|scene))\b/iu,
  /\b(?:more|less)\s+(?:of\s+)?(?:that|this)\b/iu,
];

/** True when the message reads as a modification of the current image subject. */
export function looksLikeImageFollowUp(prompt: string): boolean {
  const scene = extractScene(prompt);
  if (!scene) return false;
  return followUpModifiers.some((pattern) => pattern.test(scene));
}

/**
 * Did the recent conversation establish Cabi as the image subject?
 *
 * Used only to resolve a follow-up modifier. A follow-up is attached to whatever
 * the conversation was about, so this checks the recent turns for Cabi rather
 * than assuming she is the subject of everything.
 */
export function conversationHasCabiSubject(conversationContext: readonly string[]): boolean {
  return conversationContext
    .slice(-6)
    .some((turn) => cabiMarkers.some((pattern) => pattern.test(turn)));
}