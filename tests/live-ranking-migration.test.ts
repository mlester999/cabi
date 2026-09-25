import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/0024_lifetime_ranks_live_leaderboards.sql"), "utf8");
const runtimeFix = readFileSync(join(root, "supabase/migrations/0025_rank_award_runtime_fix.sql"), "utf8");
const leaderboardApi = readFileSync(join(root, "app/api/leaderboard/route.ts"), "utf8");
const compactBoard = readFileSync(join(root, "components/leaderboard/weekly-compact-leaderboard.tsx"), "utf8");
const fullBoard = readFileSync(join(root, "components/leaderboard/leaderboard-experience.tsx"), "utf8");

describe("live ranking migration contracts", () => {
  it("reuses the XP ledger and separates weekly, monthly, and lifetime progress", () => {
    expect(migration).toContain("alter table public.rank_xp_events");
    expect(migration).toContain("weekly_period_id uuid");
    expect(migration).toContain("monthly_period_id uuid");
    expect(migration).toContain("set lifetime_xp = greatest(0, p.lifetime_xp + v_allowed)");
    expect(migration).toContain("rank_recalculate_period(v_weekly.id)");
    expect(migration).toContain("rank_recalculate_period(v_monthly.id)");
    expect(migration).not.toMatch(/create table(?: if not exists)? public\.(?:xp_events|leaderboard_periods)\b/iu);
  });

  it("uses UTC periods and server-validated, serialized XP awards", () => {
    expect(migration).toContain("date_trunc('week', v_now at time zone 'UTC')");
    expect(migration).toContain("date_trunc('month', v_now at time zone 'UTC')");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('cabi_xp_account_'");
    expect(migration).toContain("p_quality_score integer default null");
    expect(migration).toContain("invalid quality score");
    expect(migration).toContain("p.ranking_status = 'INELIGIBLE'");
    expect(migration).toContain("'RANKING_INELIGIBLE'");
    expect(migration).toContain("quality_score, created_at");
    expect(migration).toContain("grant execute on function public.award_rank_xp(");
  });

  it("loads tuning values before applying fallback caps", () => {
    expect(runtimeFix).toContain("select daily_xp_cap, image_xp_per_day into v_cap, v_image_cap");
    expect(runtimeFix).toContain("from public.rank_tuning_view();");
    expect(runtimeFix).toContain("v_cap := coalesce(p_daily_cap, v_cap);");
    expect(runtimeFix).toContain("v_image_cap := coalesce(p_image_daily_cap, v_image_cap);");
    expect(runtimeFix).not.toMatch(/coalesce\([^\n]*rank_tuning_view\(/u);
  });

  it("freezes deterministic period results and keeps RPC access server-only", () => {
    expect(migration).toContain("rank_leaderboard_results");
    expect(migration).toContain("leaderboard result snapshots are immutable");
    expect(migration).toContain("order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc");
    expect(migration).toMatch(/revoke all on function public\.rank_leaderboard\([\s\S]*?from public, anon, authenticated;/u);
    expect(migration).toMatch(/grant execute on function public\.rank_leaderboard\([\s\S]*?to service_role;/u);
  });

  it("keeps wallet identifiers out of the public leaderboard response", () => {
    expect(leaderboardApi).not.toContain("wallet_address");
    expect(leaderboardApi).not.toContain("wallet_account_id:");
    expect(leaderboardApi).toContain("entries,");
    expect(leaderboardApi).toContain("currentUser:");
  });

  it("shows five compact leaders and avoids duplicating a user already in range", () => {
    expect(compactBoard).toContain("entry.placement <= 5");
    expect(compactBoard).toContain("(!you || you.placement > 5)");
    expect(fullBoard).toContain("entry.placement <= 100");
    expect(fullBoard).toContain("data.standing.placement > 100");
    expect(fullBoard).toContain("entry.isCurrentUser ?");
  });
});
