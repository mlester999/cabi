import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { countWalletMessages } from "@/lib/ranking/message-count";

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
  "HUNDRED_XP",
  "FIRST_IMAGE",
  "TOP_100_WEEKLY",
  "TOP_10_WEEKLY",
  "REACHED_ELITE",
  "REACHED_MASTER",
  "REACHED_LEGEND",
] as const;

export type AchievementCode = (typeof achievementCodes)[number];

/** Copy for the profile. Kept short so eight of them fit on one screen. */
export const achievementCopy: Record<AchievementCode, { label: string; description: string }> = {
  FIRST_CHAT: { label: "First chat", description: "You said hello." },
  HUNDRED_XP: { label: "100 XP", description: "A hundred points of real conversation." },
  FIRST_IMAGE: { label: "First image", description: "You asked me to draw something." },
  TOP_100_WEEKLY: { label: "Top 100", description: "Finished a week in the top hundred." },
  TOP_10_WEEKLY: { label: "Top 10", description: "Finished a week in the top ten." },
  REACHED_ELITE: { label: "Reached Elite", description: "You made it to Elite." },
  REACHED_MASTER: { label: "Reached Master", description: "You made it to Master." },
  REACHED_LEGEND: { label: "Reached Legend", description: "You reached the top tier." },
};

/** Facts the evaluator decides from. All server-observed. */
export type AchievementSignals = {
  /** Lifetime XP after this turn. */
  lifetimeXp: number;
  /** Current monthly tier number, 1-6. */
  tierNumber: number;
  /** Number of successful image generations, ever. */
  imageCount: number;
  /** Total messages this wallet has sent. */
  messageCount: number;
  /** Best finishing position in a closed weekly period, if any. */
  bestWeeklyPlacement: number | null;
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
  if (signals.lifetimeXp >= 100) earned.push("HUNDRED_XP");
  if (signals.imageCount >= 1) earned.push("FIRST_IMAGE");
  if (signals.bestWeeklyPlacement !== null && signals.bestWeeklyPlacement <= 100) earned.push("TOP_100_WEEKLY");
  if (signals.bestWeeklyPlacement !== null && signals.bestWeeklyPlacement <= 10) earned.push("TOP_10_WEEKLY");
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

  const [profileResult, messageCount, images, standing] = await Promise.all([
    db.from("profiles").select("lifetime_xp,best_leaderboard_position").eq("wallet_account_id", walletAccountId).maybeSingle(),
    countWalletMessages(walletAccountId, "user"),
    db.from("image_generations").select("id", { count: "exact", head: true }).eq("wallet_account_id", walletAccountId).eq("status", "SUCCEEDED"),
    db.rpc("rank_user_standing", { p_type: "MONTHLY", p_wallet_account_id: walletAccountId }),
  ]);

  const profile = profileResult.data as { lifetime_xp?: number; best_leaderboard_position?: number | null } | null;
  const standingRow = (Array.isArray(standing.data) ? standing.data[0] : standing.data) as { rank_tier?: number } | undefined;

  return syncAchievements(walletAccountId, {
    lifetimeXp: Number(profile?.lifetime_xp ?? 0),
    tierNumber: Number(standingRow?.rank_tier ?? 1),
    imageCount: images.count ?? 0,
    messageCount,
    bestWeeklyPlacement: profile?.best_leaderboard_position ?? null,
  });
}