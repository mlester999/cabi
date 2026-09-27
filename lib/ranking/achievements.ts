import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { countWalletMessages } from "@/lib/ranking/message-count";
import { readRankThresholds } from "@/lib/ranking/service";
import { tierForXp } from "@/lib/ranking/tiers";

/**
 * Achievements.
 *
 * Deliberately small, and permanent: unlike rank, which resets every month, an
 * achievement is never taken away. Each one is derived from server-observed
 * facts, so nothing here can be granted by a browser.
 *
 * Awarding is idempotent at the database level (`primary key
 * (wallet_account_id, code)` with `on conflict do nothing`), which means the
 * evaluator can run on every turn without risk of duplicates.
 */

export const achievementCodes = [
  "FIRST_CHAT",
  "HUNDRED_MESSAGES",
  "FIRST_MEMORY",
  "TEN_MEMORIES",
  "HUNDRED_XP",
  "FIRST_IMAGE",
  "TWENTY_FIVE_IMAGES",
  "REACHED_FAMILIAR",
  "REACHED_COMPANION",
  "TOP_100_WEEKLY",
  "TOP_10_WEEKLY",
  "WEEKLY_WINNER",
  "TOP_10_MONTHLY",
  "MONTHLY_WINNER",
  "REACHED_ELITE",
  "REACHED_MASTER",
  "REACHED_LEGEND",
] as const;

export type AchievementCode = (typeof achievementCodes)[number];

export type AchievementCategory = "Chat" | "Memory" | "Images" | "Progression" | "Leaderboard";

/** Copy and categories for the permanent milestone catalogue. */
export const achievementCopy: Record<AchievementCode, { label: string; description: string; category: AchievementCategory }> = {
  FIRST_CHAT: { label: "First chat", description: "You said hello to Cabi.", category: "Chat" },
  HUNDRED_MESSAGES: { label: "100 messages", description: "A hundred messages in your conversations with Cabi.", category: "Chat" },
  FIRST_MEMORY: { label: "First memory", description: "Cabi saved a detail for another conversation.", category: "Memory" },
  TEN_MEMORIES: { label: "Memory keeper", description: "You and Cabi have saved ten memories.", category: "Memory" },
  HUNDRED_XP: { label: "100 XP", description: "A hundred points of real conversation.", category: "Progression" },
  FIRST_IMAGE: { label: "First image", description: "You asked Cabi to draw something.", category: "Images" },
  TWENTY_FIVE_IMAGES: { label: "Image maker", description: "Twenty-five Cabi images saved to your wallet.", category: "Images" },
  REACHED_FAMILIAR: { label: "Familiar", description: "You reached the Familiar rank.", category: "Progression" },
  REACHED_COMPANION: { label: "Companion", description: "You reached the Companion rank.", category: "Progression" },
  TOP_100_WEEKLY: { label: "Weekly Top 100", description: "Finished a week in the top hundred.", category: "Leaderboard" },
  TOP_10_WEEKLY: { label: "Weekly Top 10", description: "Finished a week in the top ten.", category: "Leaderboard" },
  WEEKLY_WINNER: { label: "Weekly winner", description: "Finished a week in first place.", category: "Leaderboard" },
  TOP_10_MONTHLY: { label: "Monthly Top 10", description: "Finished a month in the top ten.", category: "Leaderboard" },
  MONTHLY_WINNER: { label: "Monthly winner", description: "Finished a month in first place.", category: "Leaderboard" },
  REACHED_ELITE: { label: "Elite", description: "You reached the Elite rank.", category: "Progression" },
  REACHED_MASTER: { label: "Master", description: "You reached the Master rank.", category: "Progression" },
  REACHED_LEGEND: { label: "Legend", description: "You reached the top rank.", category: "Progression" },
};

/** Facts the evaluator decides from. All server-observed. */
export type AchievementSignals = {
  /** Lifetime XP after this turn. */
  lifetimeXp: number;
  /** Current monthly tier number, 1-6. */
  tierNumber: number;
  /** Number of successful image generations, ever. */
  imageCount: number;
  /** Number of memories stored for this wallet. */
  memoryCount: number;
  /** Total messages this wallet has sent. */
  messageCount: number;
  /** Best finishing position in a closed weekly period, if any. */
  bestWeeklyPlacement: number | null;
  /** Best finishing position in a closed monthly period, if any. */
  bestMonthlyPlacement: number | null;
};

/**
 * Which achievements the signals qualify for.
 *
 * Pure, so it is testable without a database, and the caller cannot pass a
 * client-supplied value into it.
 */
export function qualifiedAchievements(signals: AchievementSignals): AchievementCode[] {
  const earned: AchievementCode[] = [];
  if (signals.messageCount >= 1) earned.push("FIRST_CHAT");
  if (signals.messageCount >= 100) earned.push("HUNDRED_MESSAGES");
  if (signals.memoryCount >= 1) earned.push("FIRST_MEMORY");
  if (signals.memoryCount >= 10) earned.push("TEN_MEMORIES");
  if (signals.lifetimeXp >= 100) earned.push("HUNDRED_XP");
  if (signals.imageCount >= 1) earned.push("FIRST_IMAGE");
  if (signals.imageCount >= 25) earned.push("TWENTY_FIVE_IMAGES");
  if (signals.tierNumber >= 2) earned.push("REACHED_FAMILIAR");
  if (signals.tierNumber >= 3) earned.push("REACHED_COMPANION");
  if (signals.bestWeeklyPlacement !== null && signals.bestWeeklyPlacement <= 100) earned.push("TOP_100_WEEKLY");
  if (signals.bestWeeklyPlacement !== null && signals.bestWeeklyPlacement <= 10) earned.push("TOP_10_WEEKLY");
  if (signals.bestWeeklyPlacement === 1) earned.push("WEEKLY_WINNER");
  if (signals.bestMonthlyPlacement !== null && signals.bestMonthlyPlacement <= 10) earned.push("TOP_10_MONTHLY");
  if (signals.bestMonthlyPlacement === 1) earned.push("MONTHLY_WINNER");
  if (signals.tierNumber >= 4) earned.push("REACHED_ELITE");
  if (signals.tierNumber >= 5) earned.push("REACHED_MASTER");
  if (signals.tierNumber >= 6) earned.push("REACHED_LEGEND");
  return earned;
}

/**
 * Evaluates and stores. Returns only the codes that are newly awarded, so a
 * caller can surface a single notification rather than a list.
 *
 * A failure here is reported as "nothing new" rather than thrown: an
 * achievement is a nice-to-have, and must never break a chat turn.
 */
export async function syncAchievements(walletAccountId: string, signals: AchievementSignals): Promise<AchievementCode[]> {
  const db = getServiceClient();
  if (!db) return [];
  const qualified = qualifiedAchievements(signals);
  if (qualified.length === 0) return [];

  const { data: existing } = await db
    .from("profile_achievements")
    .select("code")
    .eq("wallet_account_id", walletAccountId);
  const already = new Set((existing ?? []).map((row) => String((row as { code: string }).code)));
  const missing = qualified.filter((code) => !already.has(code));
  if (missing.length === 0) return [];

  const awarded: AchievementCode[] = [];
  for (const code of missing) {
    // The RPC returns true only when the row was actually inserted, so a race
    // between two turns reports the achievement exactly once.
    const { data, error } = await db.rpc("award_achievement", { p_wallet_account_id: walletAccountId, p_code: code });
    if (!error && data === true) awarded.push(code);
  }
  return awarded;
}

/** The wallet's permanent achievements, newest first. */
export async function readAchievements(walletAccountId: string) {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("profile_achievements")
    .select("code,awarded_at")
    .eq("wallet_account_id", walletAccountId)
    .order("awarded_at", { ascending: false });
  return (data ?? []).flatMap((row) => {
    const record = row as { code: string; awarded_at: string };
    const copy = achievementCopy[record.code as AchievementCode];
    return copy ? [{ code: record.code, awardedAt: record.awarded_at, ...copy }] : [];
  });
}
/**
 * Reads the real signals and awards anything newly qualified.
 *
 * Counting here rather than trusting a caller-supplied number is what keeps the
 * achievements honest: a message count, an image count and a placement are all
 * derived from rows the user cannot write.
 *
 * Only run after a turn that could plausibly change something, since it costs a
 * few aggregate reads.
 */
export async function refreshAchievements(walletAccountId: string): Promise<AchievementCode[]> {
  const db = getServiceClient();
  if (!db) return [];

  const [profileResult, messageCount, images, memories, weeklyResults, monthlyResults, thresholds] = await Promise.all([
    db.from("profiles").select("lifetime_xp,best_leaderboard_position").eq("wallet_account_id", walletAccountId).maybeSingle(),
    countWalletMessages(walletAccountId, "user"),
    db.from("image_generations").select("id", { count: "exact", head: true }).eq("wallet_account_id", walletAccountId).eq("status", "COMPLETED"),
    db.from("user_memories").select("id", { count: "exact", head: true }).eq("wallet_account_id", walletAccountId),
    db.from("rank_leaderboard_results").select("position,rank_seasons!inner(type)").eq("wallet_account_id", walletAccountId).eq("rank_seasons.type", "WEEKLY").order("position", { ascending: true }).limit(1),
    db.from("rank_leaderboard_results").select("position,rank_seasons!inner(type)").eq("wallet_account_id", walletAccountId).eq("rank_seasons.type", "MONTHLY").order("position", { ascending: true }).limit(1),
    readRankThresholds(),
  ]);

  const profile = profileResult.data as { lifetime_xp?: number; best_leaderboard_position?: number | null } | null;
  const bestPlacement = (rows: unknown) => {
    const row = Array.isArray(rows) ? rows[0] as { position?: number } | undefined : undefined;
    return row?.position == null ? null : Number(row.position);
  };
  const lifetimeXp = Number(profile?.lifetime_xp ?? 0);

  return syncAchievements(walletAccountId, {
    lifetimeXp,
    tierNumber: tierForXp(lifetimeXp, thresholds).tier,
    imageCount: images.count ?? 0,
    memoryCount: memories.count ?? 0,
    messageCount,
    bestWeeklyPlacement: bestPlacement(weeklyResults.data),
    bestMonthlyPlacement: bestPlacement(monthlyResults.data),
  });
}
