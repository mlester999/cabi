import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { applyDailyCap, evaluateChatXp, evaluateImageXp, fingerprint } from "@/lib/ranking/xp-rules";
import { defaultRankThresholds, rankProgress, tierByNumber, type RankTier, type RankTierKey } from "@/lib/ranking/tiers";

/**
 * Rank service.
 *
 * The single place that changes XP. Three rules hold:
 *
 * 1. **Server only.** The browser never sends an XP amount, a tier, or a score.
 *    `awardChatXp` derives everything from the message and recent history.
 * 2. **Ledger first.** The database function writes an immutable
 *    `rank_xp_events` row for every change. There is no path that mutates a
 *    total without an event.
 * 3. **Activity only.** Nothing in this module reads token ownership, balance,
 *    trading volume, or spend. Rank measures product use, not wealth.
 */

export type SeasonView = {
  id: string;
  type: "WEEKLY" | "MONTHLY";
  label: string;
  startsAt: string;
  endsAt: string;
  status: "ACTIVE" | "FINALIZED";
  thresholds: Partial<Record<RankTierKey, number>>;
  /** Milliseconds until the season closes, from a server timestamp. */
  msRemaining: number;
};

export type Standing = {
  placement: number | null;
  xp: number;
  participants: number;
  tier: RankTier;
  progress: ReturnType<typeof rankProgress>;
};

export type AwardResult = {
  xpAwarded: number;
  seasonXp: number;
  lifetimeXp: number;
  tier: RankTier;
  previousTier: RankTier;
  rankedUp: boolean;
  capped: boolean;
  reasonCode: string;
  label: string | null;
  seasonId: string | null;
};

type SeasonRow = {
  id: string;
  type: "WEEKLY" | "MONTHLY";
  label: string;
  starts_at: string;
  ends_at: string;
  status: "ACTIVE" | "FINALIZED";
  thresholds: Record<string, number> | null;
};

function toSeasonView(row: SeasonRow, now = Date.now()): SeasonView {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    thresholds: row.thresholds ?? {},
    msRemaining: Math.max(0, new Date(row.ends_at).getTime() - now),
  };
}

/**
 * Reads the live season, creating or rolling it over if needed.
 *
 * Rollover is idempotent and serialised in the database, so a leaderboard read
 * can safely be the thing that finalizes an expired period. No cron required.
 */
export async function readSeason(type: "WEEKLY" | "MONTHLY"): Promise<SeasonView | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db.rpc("rank_season_view", { p_type: type });
  if (error || !data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as SeasonRow | undefined;
  return row ? toSeasonView(row) : null;
}

/** Current server-managed rank thresholds, used for lifetime progression UI. */
export async function readRankThresholds(): Promise<Partial<Record<RankTierKey, number>>> {
  const db = getServiceClient();
  if (!db) return defaultRankThresholds;
  const { data, error } = await db.rpc("rank_tuning_view");
  if (error || !data) return defaultRankThresholds;
  const row = (Array.isArray(data) ? data[0] : data) as { thresholds?: Record<string, number> } | undefined;
  if (!row?.thresholds) return defaultRankThresholds;
  const result: Partial<Record<RankTierKey, number>> = {};
  for (const key of ["FAMILIAR", "COMPANION", "ELITE", "MASTER", "LEGEND"] as const) {
    const value = Number(row.thresholds[key]);
    if (Number.isFinite(value) && value > 0) result[key] = Math.floor(value);
  }
  return Object.keys(result).length === 5 ? result : defaultRankThresholds;
}

export async function readStanding(walletAccountId: string, type: "WEEKLY" | "MONTHLY"): Promise<Standing | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db.rpc("rank_user_standing", { p_type: type, p_wallet_account_id: walletAccountId });
  if (error || !data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { placement: number | null; xp: number | string; rank_tier: number; participants: number } | undefined;
  if (!row) return null;
  const xp = Number(row.xp ?? 0);
  return {
    placement: row.placement == null ? null : Number(row.placement),
    xp,
    participants: Number(row.participants ?? 0),
    tier: tierByNumber(Number(row.rank_tier ?? 1)),
    progress: rankProgress(xp),
  };
}

export type LeaderboardEntry = {
  placement: number;
  username: string;
  avatarPath: string | null;
  xp: number;
  tier: RankTier;
  isCurrentUser: boolean;
};

export async function readLeaderboard(
  type: "WEEKLY" | "MONTHLY",
  options: { walletAccountId?: string | null; limit?: number } = {},
): Promise<{ season: SeasonView | null; entries: LeaderboardEntry[]; available: boolean }> {
  const db = getServiceClient();
  // `available` distinguishes "nobody has earned XP yet" from "the database is
  // unreachable", so the UI never shows a confident empty board when it simply
  // could not read one.
  if (!db) return { season: null, entries: [], available: false };
  const [{ data, error }, season] = await Promise.all([
    db.rpc("rank_leaderboard", { p_type: type, p_limit: options.limit ?? 100, p_wallet_account_id: options.walletAccountId ?? null }),
    readSeason(type),
  ]);
  if (error || !data) return { season, entries: [], available: false };
  const rows = data as Array<{ placement: number; username: string; avatar_path: string | null; xp: number | string; rank_tier: number; is_current_user: boolean }>;
  return {
    season,
    available: true,
    entries: rows.map((row) => ({
      placement: Number(row.placement),
      username: row.username,
      avatarPath: row.avatar_path,
      xp: Number(row.xp ?? 0),
      tier: tierByNumber(Number(row.rank_tier ?? 1)),
      isCurrentUser: Boolean(row.is_current_user),
    })),
  };
}

/** Seasonal rank history for the profile page. Never deleted on reset. */
export async function readSeasonHistory(walletAccountId: string, limit = 12) {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("rank_user_stats")
    .select("xp,rank_tier,position_snapshot,rank_seasons(type,label,starts_at,ends_at,status)")
    .eq("wallet_account_id", walletAccountId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const season = (Array.isArray(record.rank_seasons) ? record.rank_seasons[0] : record.rank_seasons) as
      | { type: string; label: string; starts_at: string; ends_at: string; status: string }
      | null;
    return {
      type: season?.type ?? "MONTHLY",
      label: season?.label ?? "Season",
      startsAt: season?.starts_at ?? null,
      endsAt: season?.ends_at ?? null,
      status: season?.status ?? "FINALIZED",
      xp: Number(record.xp ?? 0),
      tier: tierByNumber(Number(record.rank_tier ?? 1)),
      placement: record.position_snapshot == null ? null : Number(record.position_snapshot),
    };
  });
}

async function award(input: {
  walletAccountId: string;
  xp: number;
  eventType: string;
  reasonCode: string;
  conversationId?: string | null;
  messageId?: string | null;
  contentFingerprint?: string | null;
  dailyCap?: number;
  imageDailyCap?: number;
  qualityScore?: number;
}): Promise<AwardResult | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db.rpc("award_rank_xp", {
    p_wallet_account_id: input.walletAccountId,
    p_xp: input.xp,
    p_event_type: input.eventType,
    p_reason_code: input.reasonCode,
    p_conversation_id: input.conversationId ?? null,
    p_message_id: input.messageId ?? null,
    p_content_fingerprint: input.contentFingerprint ?? null,
    p_daily_cap: input.dailyCap ?? undefined,
    p_image_daily_cap: input.imageDailyCap ?? undefined,
    p_quality_score: input.qualityScore ?? 0,
  });
  if (error || !data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    awarded: number; season_xp: number | string; lifetime_xp: number | string;
    rank_tier: number; previous_tier: number; capped: boolean;
  } | undefined;
  if (!row) return null;
  const tier = tierByNumber(Number(row.rank_tier ?? 1));
  const previousTier = tierByNumber(Number(row.previous_tier ?? 1));
  return {
    xpAwarded: Number(row.awarded ?? 0),
    seasonXp: Number(row.season_xp ?? 0),
    lifetimeXp: Number(row.lifetime_xp ?? 0),
    tier,
    previousTier,
    rankedUp: tier.tier > previousTier.tier,
    capped: Boolean(row.capped),
    reasonCode: input.reasonCode,
    label: null,
    seasonId: null,
  };
}

/**
 * Awards XP for one chat turn.
 *
 * The evaluator decides the amount; the caller supplies only facts it can
 * observe server-side (the message, recent messages, timing, whether a feature
 * was used). A duplicate or a flood produces zero or a small penalty, and a
 * penalty is floored at whatever the database accepts - never a negative total.
 */
export async function awardChatXp(input: {
  walletAccountId: string;
  message: string;
  conversationId: string | null;
  messageId: string | null;
  recentUserMessages: readonly string[];
  recentTimestamps: readonly number[];
  usedFeature?: boolean;
  memoryInteraction?: boolean;
  isFollowUp?: boolean;
  now?: number;
  dailyCap?: number;
}): Promise<AwardResult | null> {
  const now = input.now ?? Date.now();
  const decision = evaluateChatXp({
    message: input.message,
    recentUserMessages: input.recentUserMessages,
    recentTimestamps: input.recentTimestamps,
    now,
    usedFeature: input.usedFeature,
    memoryInteraction: input.memoryInteraction,
    isFollowUp: input.isFollowUp,
  });

  const capped = applyDailyCap(decision, 0, input.dailyCap);
  const xp = capped.xp;

  // Keep a body-free audit row for every server-rated turn, including ordinary
  // low-effort zero-XP messages. Message retries remain idempotent in SQL.
  if (xp === 0 && decision.xp >= 0) {
    const result = await award({
      walletAccountId: input.walletAccountId,
      xp: 0,
      eventType: decision.eventType,
      reasonCode: decision.reasonCode,
      conversationId: input.conversationId,
      messageId: input.messageId,
      contentFingerprint: fingerprint(input.message),
      dailyCap: input.dailyCap,
      qualityScore: qualityScoreNumber(decision.quality),
    });
    return result ? { ...result, label: null } : null;
  }

  const result = await award({
    walletAccountId: input.walletAccountId,
    xp,
    eventType: decision.eventType,
    reasonCode: decision.reasonCode,
    conversationId: input.conversationId,
    messageId: input.messageId,
    contentFingerprint: fingerprint(input.message),
    dailyCap: input.dailyCap,
    qualityScore: qualityScoreNumber(decision.quality),
  });
  return result ? { ...result, label: decision.label } : null;
}

/**
 * How many image XP grants this wallet has already received today.
 *
 * Needed because the "first image of the day only" rule is meaningless without
 * it: passing a constant here would silently award the bonus on every
 * generation, turning a paid API into a repeatable XP source.
 */
export async function countImageXpToday(walletAccountId: string): Promise<number> {
  const db = getServiceClient();
  if (!db) return 0;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("rank_xp_events")
    .select("id", { count: "exact", head: true })
    .eq("wallet_account_id", walletAccountId)
    .eq("event_type", "IMAGE_GENERATION")
    .gte("created_at", startOfDay.toISOString());
  return count ?? 0;
}

/** Image generation earns a tiny, tightly capped amount. */
export async function awardImageXp(input: {
  walletAccountId: string;
  imagesRewardedToday: number;
  conversationId?: string | null;
}): Promise<AwardResult | null> {
  const decision = evaluateImageXp(input.imagesRewardedToday);
  if (decision.xp <= 0) {
    const result = await award({
      walletAccountId: input.walletAccountId,
      xp: 0,
      eventType: decision.eventType,
      reasonCode: decision.reasonCode,
      conversationId: input.conversationId ?? null,
      qualityScore: qualityScoreNumber(decision.quality),
    });
    return result ? { ...result, label: null } : null;
  }
  const result = await award({
    walletAccountId: input.walletAccountId,
    xp: decision.xp,
    eventType: decision.eventType,
    reasonCode: decision.reasonCode,
    qualityScore: qualityScoreNumber(decision.quality),
    conversationId: input.conversationId ?? null,
  });
  return result ? { ...result, label: decision.label } : null;
}

/** Admin adjustment. Bypasses automatic caps and is always audited by the caller. */
export async function adjustXp(input: {
  walletAccountId: string;
  delta: number;
  reason: string;
}): Promise<AwardResult | null> {
  return award({
    walletAccountId: input.walletAccountId,
    xp: input.delta,
    eventType: "ADMIN_ADJUSTMENT",
    reasonCode: "ADMIN",
  });
}

export const rankThresholds = defaultRankThresholds;

function qualityScoreNumber(quality: "LOW" | "NORMAL" | "GOOD" | "GREAT") {
  return quality === "LOW" ? 0 : quality === "NORMAL" ? 1 : quality === "GOOD" ? 2 : 3;
}

/** Clears any client-held notion of rank by simply not having one. */
export type { RankTier };
