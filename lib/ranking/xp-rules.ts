/**
 * Deterministic XP rules.
 *
 * This module is the anti-farming core. It is pure and server-only in effect:
 * nothing here reads a request, and the client has no equivalent. XP is decided
 * from the message content plus recent history, then written to the immutable
 * ledger by the database function.
 *
 * Design commitments, in order of importance:
 *
 * 1. **Never punish people.** Negative XP is reserved for unambiguous farming:
 *    a repeated identical message, or flooding. Short questions, typos, a
 *    second language, emotional conversations, disagreement with Cabi, and
 *    sensitive topics are explicitly NOT penalised - several of them are
 *    rewarded, because they are the conversations that matter.
 * 2. **Prefer zero to negative.** When a signal is ambiguous the answer is 0.
 * 3. **Never let volume beat quality.** The daily cap plus per-event ceilings
 *    mean nobody reaches a high tier by sending many cheap messages.
 * 4. **Rank is activity only.** No input to this evaluator comes from token
 *    ownership, balance, trades, or spend.
 */

export type XpEventType =
  | "CHAT_MEANINGFUL"
  | "CHAT_HIGH_QUALITY"
  | "CHAT_FOLLOWUP"
  | "MEMORY_INTERACTION"
  | "IMAGE_GENERATION"
  | "FEATURE_DISCOVERY"
  | "SPAM_DUPLICATE"
  | "SPAM_RATE_LIMIT"
  | "ADMIN_ADJUSTMENT"
  | "MILESTONE"
  | "ACHIEVEMENT";

export type XpReasonCode =
  | "SHORT_QUESTION"
  | "MEANINGFUL_MESSAGE"
  | "SUBSTANTIVE_MESSAGE"
  | "FOLLOW_UP"
  | "FEATURE_USE"
  | "FIRST_OF_DAY"
  | "DUPLICATE_MESSAGE"
  | "FLOODING"
  | "LOW_EFFORT"
  | "ADMIN"
  | "ACHIEVEMENT"
  | "GENERAL";

export type XpDecision = {
  eventType: XpEventType;
  xp: number;
  reasonCode: XpReasonCode;
  /** Short, safe, user-facing label. Never internal reasoning. */
  label: string | null;
};

export const xpRules = {
  /** A genuine question or statement of reasonable length. */
  meaningfulMin: 2,
  meaningfulMax: 8,
  /** A long, substantive turn. */
  highQualityMin: 9,
  highQualityMax: 12,
  /** Reward for building on the previous turn instead of restarting. */
  followUpBonus: 3,
  /** Using a Cabi feature (slash command, wallet read, token lookup). */
  featureBonus: 2,
  /** First image of the day only. Repeated generation earns nothing. */
  firstImageOfDay: 5,
  /** Daily ceiling on positive automatic XP. */
  dailyCap: 500,
  /** Image-generation awards per day that can carry XP. */
  imageXpPerDay: 1,
  /** A duplicate of a recent message: zero, never a reward. */
  duplicatePenalty: 0,
  /** Unambiguous flooding only. Small, and capped by the floor at zero. */
  floodPenalty: -2,
  minLength: 12,
  maxLength: 4_000,
  /** How far back duplicate detection looks. */
  duplicateWindow: 12,
  /** Messages within this window count toward flooding. */
  floodWindowMs: 20_000,
  floodThreshold: 5,
} as const;

/** Normalises a message for comparison: case, whitespace and punctuation folded. */
export function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Stable, non-reversible fingerprint.
 *
 * Used for duplicate detection so the ledger does not need to store message
 * bodies. A cheap 53-bit hash is enough here: this detects accidental and
 * lazy repetition, it is not a security boundary.
 */
export function fingerprint(value: string): string {
  const normalized = normalizeForComparison(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}:${normalized.length}`;
}

/** Character-n-gram similarity in [0,1], used to catch reworded repetition. */
export function similarity(left: string, right: string, size = 3): number {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value: string) => {
    if (value.length <= size) return new Set([value]);
    const set = new Set<string>();
    for (let index = 0; index <= value.length - size; index += 1) set.add(value.slice(index, index + size));
    return set;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  return (2 * shared) / (leftGrams.size + rightGrams.size);
}

const nearDuplicateThreshold = 0.92;

/** True when this message is effectively a repeat of a recent one. */
export function isNearDuplicate(message: string, recent: readonly string[]): boolean {
  for (const previous of recent) {
    if (similarity(message, previous) >= nearDuplicateThreshold) return true;
  }
  return false;
}

export type ChatSignals = {
  message: string;
  /** Recent user messages in this conversation, oldest first, excluding `message`. */
  recentUserMessages: readonly string[];
  /** Timestamps (ms) of recent user messages, including `message`. */
  recentTimestamps: readonly number[];
  now: number;
  /** True when this turn used a Cabi feature (slash command, wallet read, token lookup). */
  usedFeature?: boolean;
  /** True when this turn asked Cabi to remember or forget something. */
  memoryInteraction?: boolean;
  /** True when the user is continuing the previous exchange rather than restating. */
  isFollowUp?: boolean;
};

/**
 * Decides the XP for one chat turn.
 *
 * Ordering matters: farming signals are checked before quality signals, so a
 * long spam message cannot out-earn a short genuine one.
 */
export function evaluateChatXp(signals: ChatSignals): XpDecision {
  const message = signals.message.trim();

  // 1. Unambiguous flooding: many messages in a very short window.
  const recentBurst = signals.recentTimestamps.filter((at) => signals.now - at <= xpRules.floodWindowMs).length;
  if (recentBurst >= xpRules.floodThreshold) {
    return { eventType: "SPAM_RATE_LIMIT", xp: xpRules.floodPenalty, reasonCode: "FLOODING", label: null };
  }

  // 2. Exact or near duplicate of a recent message. Zero, never negative: a
  //    person may legitimately repeat themselves, and that must not be punished.
  if (isNearDuplicate(message, signals.recentUserMessages)) {
    return { eventType: "SPAM_DUPLICATE", xp: xpRules.duplicatePenalty, reasonCode: "DUPLICATE_MESSAGE", label: null };
  }

  // 3. Too short to be an effort signal on its own. Zero, not negative: "why?",
  //    "thanks", and "no" are all real contributions to a conversation.
  const words = normalizeForComparison(message).split(" ").filter(Boolean);
  if (message.length < xpRules.minLength || words.length < 3) {
    // A short message that uses a feature still earns the small feature bonus.
    if (signals.usedFeature) {
      return { eventType: "FEATURE_DISCOVERY", xp: xpRules.featureBonus, reasonCode: "FEATURE_USE", label: "Feature used" };
    }
    return { eventType: "CHAT_MEANINGFUL", xp: 0, reasonCode: "SHORT_QUESTION", label: null };
  }

  // 4. A long turn earns the high-quality band. Length alone is capped, so a
  //    pasted wall of text is not a jackpot.
  const isSubstantive = message.length >= 220 && words.length >= 40;
  let xp = isSubstantive
    ? xpRules.highQualityMax
    : clamp(
      xpRules.meaningfulMin + Math.floor(Math.min(message.length, 600) / 150),
      xpRules.meaningfulMin,
      xpRules.meaningfulMax,
    );
  let eventType: XpEventType = isSubstantive ? "CHAT_HIGH_QUALITY" : "CHAT_MEANINGFUL";
  let reasonCode: XpReasonCode = isSubstantive ? "SUBSTANTIVE_MESSAGE" : "MEANINGFUL_MESSAGE";

  // 5. Building on the previous turn is the clearest signal of a real
  //    conversation rather than a series of disconnected prompts.
  if (signals.isFollowUp) {
    xp += xpRules.followUpBonus;
    reasonCode = "FOLLOW_UP";
    eventType = "CHAT_FOLLOWUP";
  }

  // 6. A memory interaction is genuine product use.
  if (signals.memoryInteraction) {
    xp += xpRules.featureBonus;
    eventType = "MEMORY_INTERACTION";
    reasonCode = "FEATURE_USE";
  } else if (signals.usedFeature && !signals.isFollowUp) {
    xp += xpRules.featureBonus;
    eventType = "FEATURE_DISCOVERY";
    reasonCode = "FEATURE_USE";
  }

  return {
    eventType,
    xp: clamp(xp, 0, xpRules.highQualityMax + xpRules.followUpBonus + xpRules.featureBonus),
    reasonCode,
    // Only substantial awards are surfaced in chat, so the transcript is not
    // cluttered with a "+3 XP" badge after every message.
    label: xp >= 8 ? reasonLabel(reasonCode) : null,
  };
}

function reasonLabel(code: XpReasonCode): string {
  switch (code) {
    case "FOLLOW_UP": return "Good follow-up";
    case "SUBSTANTIVE_MESSAGE": return "Meaningful chat";
    case "FEATURE_USE": return "Feature used";
    case "MEANINGFUL_MESSAGE": return "Meaningful chat";
    default: return "Meaningful chat";
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** XP for one image generation. Only the first of the day is worth anything. */
export function evaluateImageXp(imagesAlreadyRewardedToday: number): XpDecision {
  if (imagesAlreadyRewardedToday >= xpRules.imageXpPerDay) {
    return { eventType: "IMAGE_GENERATION", xp: 0, reasonCode: "GENERAL", label: null };
  }
  return { eventType: "IMAGE_GENERATION", xp: xpRules.firstImageOfDay, reasonCode: "FIRST_OF_DAY", label: "First image today" };
}

/**
 * Applies the daily ceiling to a positive award.
 *
 * Returned separately from the decision so the caller can log that a cap was
 * hit without the evaluator needing database access.
 */
export function applyDailyCap(decision: XpDecision, xpEarnedToday: number, cap: number = xpRules.dailyCap) {
  if (decision.xp <= 0) return { xp: decision.xp, capped: false };
  const remaining = Math.max(0, cap - xpEarnedToday);
  const xp = Math.min(decision.xp, remaining);
  return { xp, capped: xp < decision.xp };
}