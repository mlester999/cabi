import "server-only";

import type { AwardResult } from "@/lib/ranking/service";
import { awardChatXp } from "@/lib/ranking/service";
import { storeImplicitMemory } from "@/lib/memory/store";
import { fingerprint } from "@/lib/ranking/xp-rules";
import { refreshAchievements, type AchievementCode } from "@/lib/ranking/achievements";

/**
 * The social side effects of one completed chat turn.
 *
 * Deliberately isolated from the streaming path and wrapped so that a ranking or
 * memory failure can never break a reply. XP and memory are additive features; a
 * database hiccup must not cost the user their conversation.
 *
 * Both writes are server-authoritative. The browser sends only the message text;
 * it has no way to influence an XP amount or a stored fact.
 */

export type ChatTurnSocial = {
  /** Null when the turn earned nothing or the write failed. */
  xp: AwardResult | null;
  /** The fact Cabi chose to remember, if any. */
  remembered: { category: string; content: string } | null;
  /** XP events recorded today, so the caller can surface a subtle progress note. */
  surfacedXp: number | null;
  /** Achievements newly earned by this turn, for a single quiet notification. */
  achievements: AchievementCode[];
};

export type RecentTurn = { role: "user" | "assistant"; content: string; at: number };

/**
 * Derives the signals the evaluator needs from the conversation transcript.
 *
 * `recent` is the current conversation in order. The most recent entry is the
 * user message being answered.
 */
export function deriveChatSignals(recent: readonly RecentTurn[], featureUsed: boolean) {
  const userTurns = recent.filter((turn) => turn.role === "user");
  const priorUserMessages = userTurns.slice(0, -1).map((turn) => turn.content);
  // A follow-up is a user message sent after Cabi has replied, which is the
  // clearest available signal that this is a conversation rather than a series
  // of isolated prompts.
  const lastBefore = recent.at(-2);
  return {
    recentUserMessages: priorUserMessages,
    recentTimestamps: userTurns.map((turn) => turn.at),
    isFollowUp: Boolean(lastBefore && lastBefore.role === "assistant"),
    usedFeature: featureUsed,
  };
}

/**
 * Records everything the social layer owes for one turn.
 *
 * `persist` is false for temporary guest chats, in which case nothing is written
 * to the database at all: a guest has no rank and no stored memory.
 */
export async function recordChatTurnSocial(input: {
  walletAccountId: string | null;
  profileId: string | null;
  conversationId: string | null;
  userMessageId: string | null;
  message: string;
  recent: readonly RecentTurn[];
  featureUsed?: boolean;
  memoryEnabled: boolean;
  /** Set when the message was a memory command, which earns a small bonus. */
  memoryInteraction?: boolean;
}): Promise<ChatTurnSocial> {
  if (!input.walletAccountId) return { xp: null, remembered: null, surfacedXp: null, achievements: [] };

  const signals = deriveChatSignals(input.recent, Boolean(input.featureUsed));

  // Memory and XP are independent: a memory write failing must not suppress XP.
  const [xp, remembered] = await Promise.all([
    awardChatXp({
      walletAccountId: input.walletAccountId,
      message: input.message,
      conversationId: input.conversationId,
      messageId: input.userMessageId,
      recentUserMessages: signals.recentUserMessages,
      recentTimestamps: signals.recentTimestamps,
      usedFeature: signals.usedFeature,
      isFollowUp: signals.isFollowUp,
      memoryInteraction: input.memoryInteraction,
    }).catch(() => null),
    input.memoryEnabled
      ? storeImplicitMemory(input.walletAccountId, input.userMessageId, input.message).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Achievements are decided from real row counts rather than from anything the
  // caller passes in, so a client cannot assert its own progress. A failure here
  // is swallowed: an achievement must never cost a user their reply.
  const achievements = await refreshAchievements(input.walletAccountId).catch((): AchievementCode[] => []);

  return {
    xp,
    achievements,
    remembered: remembered ? { category: remembered.category, content: remembered.content } : null,
    // Only surfaced when the award is large enough to be worth mentioning, so
    // the transcript is not littered with "+3 XP" after every message.
    surfacedXp: xp && xp.xpAwarded >= 8 ? xp.xpAwarded : null,
  };
}

/** True when a message is a duplicate of something recent, for the UI's benefit. */
export function isRepeatedMessage(message: string, recent: readonly RecentTurn[]) {
  const recentUser = recent.filter((turn) => turn.role === "user").slice(0, -1).map((turn) => turn.content);
  const candidate = fingerprint(message);
  return recentUser.some((previous) => fingerprint(previous) === candidate);
}