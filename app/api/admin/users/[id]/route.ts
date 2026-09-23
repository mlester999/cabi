import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";
import { readBondProfile } from "@/lib/bond-profile";
import { readAchievements } from "@/lib/ranking/achievements";
import { countWalletMessages } from "@/lib/ranking/message-count";
import { readSeason, readSeasonHistory, readStanding } from "@/lib/ranking/service";
import { tierByNumber } from "@/lib/ranking/tiers";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Admin view of one account.
 *
 * Shows identity and progression only. Private conversation content is
 * deliberately NOT included: an operator needs to see whether an account is
 * farming, and that is answerable from counts and XP events without reading
 * anyone's messages.
 *
 * The wallet address is shown here because the owner needs it to pay out a
 * reward, and this surface is admin-only.
 */
export async function GET(request: Request, { params }: Params) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return jsonError("Invalid account id.", 400, "INVALID_INPUT");

  const db = getServiceClient();
  if (!db) return jsonError("Storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const { data: profile } = await db
    .from("profiles")
    .select("id,wallet_account_id,username,display_name,preferred_name,avatar_path,profile_completed_at,ranking_status,lifetime_xp,best_rank_tier,best_leaderboard_position,created_at,updated_at")
    .eq("wallet_account_id", id)
    .maybeSingle();
  if (!profile) return jsonError("That account does not exist.", 404, "NOT_FOUND");

  const row = profile as Record<string, unknown>;
  const profileId = String(row.id);

  const [wallet, weekly, monthly, history, bond, achievements, messages, images, xpEvents, rewards, monthlySeason, count] = await Promise.all([
    db.from("wallet_accounts").select("wallet_address,created_at").eq("id", id).maybeSingle(),
    readStanding(id, "WEEKLY"),
    readStanding(id, "MONTHLY"),
    readSeasonHistory(id, 12),
    readBondProfile(id, profileId),
    readAchievements(id),
    countWalletMessages(id, "user"),
    db.from("image_generations").select("id", { count: "exact", head: true }).eq("wallet_account_id", id),
    // The ledger is the audit trail for XP, so it is shown verbatim.
    db.from("rank_xp_events").select("id,xp_delta,event_type,reason_code,created_at").eq("wallet_account_id", id).order("created_at", { ascending: false }).limit(40),
    db.from("rank_reward_snapshots").select("id,placement,xp,reward_status,season_id").eq("wallet_account_id", id).order("created_at", { ascending: false }).limit(20),
    readSeason("MONTHLY"),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("wallet_account_id", id),
  ]);

  const walletRow = wallet.data as { wallet_address?: string } | null;

  return Response.json(
    {
      account: {
        walletAccountId: id,
        walletAddress: walletRow?.wallet_address ?? null,
        username: (row.username as string | null) ?? null,
        displayName: (row.display_name as string | null) ?? null,
        preferredName: (row.preferred_name as string | null) ?? null,
        avatarPath: (row.avatar_path as string | null) ?? null,
        profileComplete: Boolean(row.profile_completed_at),
        rankingStatus: (row.ranking_status as string) ?? "NORMAL",
        joinedAt: (row.created_at as string | null) ?? null,
        lastActiveAt: (row.updated_at as string | null) ?? null,
      },
      rank: {
        monthly: monthly ? { xp: monthly.xp, placement: monthly.placement, participants: monthly.participants, tier: monthly.tier, seasonLabel: monthlySeason?.label ?? null } : null,
        weekly: weekly ? { xp: weekly.xp, placement: weekly.placement, participants: weekly.participants, tier: weekly.tier } : null,
        lifetimeXp: Number(row.lifetime_xp ?? 0),
        bestTier: row.best_rank_tier == null ? null : tierByNumber(Number(row.best_rank_tier)),
        bestPlacement: row.best_leaderboard_position == null ? null : Number(row.best_leaderboard_position),
      },
      counts: {
        conversations: count.count ?? 0,
        messages,
        memories: bond.memoryCount,
        images: images.count ?? 0,
      },
      bond: { level: bond.level, label: bond.label, progress: bond.progress, conversationDays: bond.conversationDays },
      achievements,
      history,
      xpEvents: (xpEvents.data ?? []).map((event) => {
        const record = event as Record<string, unknown>;
        return { id: Number(record.id), delta: Number(record.xp_delta), eventType: String(record.event_type), reasonCode: String(record.reason_code), createdAt: String(record.created_at) };
      }),
      rewards: rewards.data ?? [],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const patchSchema = z.object({ rankingStatus: z.enum(["NORMAL", "REVIEW", "INELIGIBLE"]) });

/** Eligibility flag. A flagged account keeps chatting; it only leaves the board. */
export async function PATCH(request: Request, { params }: Params) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const db = getServiceClient();
  if (!db) return jsonError("Storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const { error } = await db
    .from("profiles")
    .update({ ranking_status: parsed.data.rankingStatus, updated_at: new Date().toISOString() })
    .eq("wallet_account_id", id);
  if (error) return jsonError("That flag could not be set.", 503, "UPDATE_FAILED");

  await auditAdmin(request, auth.session!.email, "ranking.eligibility", "wallet_account", id, "success", { status: parsed.data.rankingStatus });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}