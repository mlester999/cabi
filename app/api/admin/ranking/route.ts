import { z } from "zod";

import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";
import { adjustXp, readLeaderboard, readSeason } from "@/lib/ranking/service";
import { tierByNumber } from "@/lib/ranking/tiers";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

/**
 * Admin ranking console.
 *
 * Season reads provision and roll over as a side effect, which is intentional:
 * an expired week is finalized by the first read rather than by a cron job. All
 * writes are audited, and history is never deleted - a reset closes the current
 * period and opens the next one.
 */
export async function GET() {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const db = getServiceClient();
  if (!db) return jsonError("Ranking storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const [{ data: tuningData }, { season: weekly, entries: weeklyTop }, { season: monthly, entries: monthlyTop }] = await Promise.all([
    db.rpc("rank_tuning_view"),
    readLeaderboard("WEEKLY", { limit: 10 }),
    readLeaderboard("MONTHLY", { limit: 10 }),
  ]);

  const summaryFor = async (seasonId: string | undefined) => {
    if (!seasonId) return null;
    const { data } = await db.rpc("rank_season_summary", { p_season_id: seasonId });
    const row = (Array.isArray(data) ? data[0] : data) as { participants: number; total_xp: number | string; top_username: string | null; top_xp: number | string | null } | undefined;
    return row
      ? { participants: Number(row.participants ?? 0), totalXp: Number(row.total_xp ?? 0), topUsername: row.top_username, topXp: row.top_xp == null ? null : Number(row.top_xp) }
      : null;
  };

  const [{ data: pendingRewards }, { data: flagged }] = await Promise.all([
    db.from("rank_reward_snapshots").select("id,season_id,placement,xp,username,wallet_address,reward_status,admin_note,rewarded_at,rank_seasons(type,label)").order("created_at", { ascending: false }).limit(50),
    db.from("profiles").select("wallet_account_id,username,ranking_status").neq("ranking_status", "NORMAL").limit(50),
  ]);

  const [weeklySummary, monthlySummary] = await Promise.all([summaryFor(weekly?.id), summaryFor(monthly?.id)]);

  return Response.json(
    {
      tuning: (Array.isArray(tuningData) ? tuningData[0] : tuningData) ?? null,
      weekly: { season: weekly, summary: weeklySummary, top: weeklyTop },
      monthly: { season: monthly, summary: monthlySummary, top: monthlyTop },
      rewards: (pendingRewards ?? []).map((row) => {
        const record = row as Record<string, unknown>;
        const season = (Array.isArray(record.rank_seasons) ? record.rank_seasons[0] : record.rank_seasons) as { type: string; label: string } | null;
        return {
          id: String(record.id),
          placement: Number(record.placement),
          xp: Number(record.xp),
          username: (record.username as string | null) ?? null,
          // Shown to the owner so a manual payout can be made. Never public.
          walletAddress: (record.wallet_address as string | null) ?? null,
          status: String(record.reward_status),
          note: (record.admin_note as string | null) ?? null,
          rewardedAt: (record.rewarded_at as string | null) ?? null,
          seasonType: season?.type ?? null,
          seasonLabel: season?.label ?? null,
        };
      }),
      flagged: flagged ?? [],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset"), type: z.enum(["WEEKLY", "MONTHLY"]) }),
  z.object({ action: z.literal("adjust"), walletAccountId: z.string().uuid(), delta: z.number().int().min(-5000).max(5000).refine((value) => value !== 0, "Enter a non-zero amount."), reason: z.string().trim().min(3).max(200) }),
  z.object({ action: z.literal("reward"), id: z.number().int().positive(), status: z.enum(["PENDING", "REWARDED", "SKIPPED"]), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("eligibility"), walletAccountId: z.string().uuid(), status: z.enum(["NORMAL", "REVIEW", "INELIGIBLE"]) }),
  z.object({
    action: z.literal("tuning"),
    // Bounds are enforced here as well as in SQL, so a typo cannot make the
    // ranking unusable (zero) or trivial (absurdly low).
    thresholds: z.object({
      EXPLORER: z.number().int().min(1).max(1_000_000),
      COMPANION: z.number().int().min(1).max(1_000_000),
      ELITE: z.number().int().min(1).max(1_000_000),
      MASTER: z.number().int().min(1).max(1_000_000),
      LEGEND: z.number().int().min(1).max(1_000_000),
    }),
    dailyXpCap: z.number().int().min(1).max(100_000),
    imageXpPerDay: z.number().int().min(0).max(50),
    rewardPlacements: z.number().int().min(1).max(1_000),
  }),
]);

export async function POST(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session;


  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const db = getServiceClient();
  if (!db) return jsonError("Ranking storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  if (parsed.data.action === "tuning") {
    const { thresholds, dailyXpCap, imageXpPerDay, rewardPlacements } = parsed.data;
    // Monotonic thresholds: each tier must cost more than the one before it, or
    // someone could be shown as Legend without ever passing Master.
    const ordered = thresholds.EXPLORER < thresholds.COMPANION
      && thresholds.COMPANION < thresholds.ELITE
      && thresholds.ELITE < thresholds.MASTER
      && thresholds.MASTER < thresholds.LEGEND;
    if (!ordered) return jsonError("Each rank threshold must be higher than the one before it.", 400, "INVALID_THRESHOLDS");

    const { error } = await db
      .from("app_settings")
      .upsert({ key: "ranking", value_json: { thresholds, dailyXpCap, imageXpPerDay, rewardPlacements }, updated_by: admin.email }, { onConflict: "key" });
    if (error) return jsonError("Those settings could not be saved.", 503, "SAVE_FAILED");

    await auditAdmin(request, admin.email, "ranking.tuning", "app_settings", "ranking", "success", { thresholds, dailyXpCap, imageXpPerDay, rewardPlacements });
    // Thresholds are frozen into a season when it is created, so this applies
    // from the next season rather than rewriting the board currently being raced.
    return Response.json({ ok: true, appliesFrom: "next season" }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (parsed.data.action === "reset") {
    // Closes the active period and opens the next one. The old season keeps its
    // stats, frozen placements and reward snapshots.
    const { data, error } = await db.rpc("admin_reset_rank_season", { p_type: parsed.data.type });
    if (error) return jsonError("That period could not be reset.", 503, "RESET_FAILED");
    const row = (Array.isArray(data) ? data[0] : data) as { closed_season_id: string | null; new_season_id: string } | undefined;
    await auditAdmin(request, admin.email, "ranking.reset", parsed.data.type === "WEEKLY" ? "rank_season_weekly" : "rank_season_monthly", row?.new_season_id ?? null, "success", { closedSeasonId: row?.closed_season_id ?? null });
    return Response.json({ ok: true, closedSeasonId: row?.closed_season_id ?? null, newSeason: await readSeason(parsed.data.type) }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (parsed.data.action === "adjust") {
    const result = await adjustXp({ walletAccountId: parsed.data.walletAccountId, delta: parsed.data.delta, reason: parsed.data.reason });
    if (!result) return jsonError("That adjustment could not be applied.", 503, "ADJUST_FAILED");
    // A manual adjustment always produces both an XP event (inside the database
    // function) and an audit row (here).
    await auditAdmin(request, admin.email, "ranking.xp_adjust", "wallet_account", parsed.data.walletAccountId, "success", { delta: parsed.data.delta, reason: parsed.data.reason, tier: result.tier.key, seasonXp: result.seasonXp });
    return Response.json({ ok: true, seasonXp: result.seasonXp, lifetimeXp: result.lifetimeXp, tier: tierByNumber(result.tier.tier) }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (parsed.data.action === "reward") {
    const { error } = await db
      .from("rank_reward_snapshots")
      .update({
        reward_status: parsed.data.status,
        admin_note: parsed.data.note ?? null,
        rewarded_at: parsed.data.status === "REWARDED" ? new Date().toISOString() : null,
      })
      .eq("id", parsed.data.id);
    if (error) return jsonError("That reward could not be updated.", 503, "UPDATE_FAILED");
    await auditAdmin(request, admin.email, "ranking.reward_status", "rank_reward_snapshot", String(parsed.data.id), "success", { status: parsed.data.status });
    // Deliberately no token transfer: the site records the decision, the owner
    // makes the payout.
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { error } = await db
    .from("profiles")
    .update({ ranking_status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("wallet_account_id", parsed.data.walletAccountId);
  if (error) return jsonError("That flag could not be set.", 503, "UPDATE_FAILED");
  await auditAdmin(request, admin.email, "ranking.eligibility", "wallet_account", parsed.data.walletAccountId, "success", { status: parsed.data.status });
  // The account is not disabled: a flagged user keeps chatting, and only drops
  // off the reward leaderboard.
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}