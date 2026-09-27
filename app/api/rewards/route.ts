import { featureGate } from "@/lib/config/feature-gate";
import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/** Read only the reward snapshots belonging to the signed-in wallet. */
export async function GET() {
  const locked = await featureGate("rewards_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const db = getServiceClient();
  if (!db) return jsonError("Rewards are not available right now.", 503, "DATABASE_NOT_CONFIGURED");
  const { data, error } = await db
    .from("rank_reward_snapshots")
    .select("id,placement,xp,reward_status,reward_amount,transaction_hash,admin_note,rewarded_at,created_at,rank_seasons!inner(type,label,starts_at,ends_at)")
    .eq("wallet_account_id", auth.identity.walletAccountId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return jsonError("Rewards are not available right now.", 503, "REWARDS_UNAVAILABLE");

  const rewards = (data ?? []).map((value) => {
    const row = value as Record<string, unknown>;
    const season = (Array.isArray(row.rank_seasons) ? row.rank_seasons[0] : row.rank_seasons) as Record<string, unknown> | null;
    return {
      id: String(row.id),
      placement: Number(row.placement),
      xp: Number(row.xp),
      status: String(row.reward_status),
      amount: row.reward_amount == null ? null : String(row.reward_amount),
      transactionHash: (row.transaction_hash as string | null) ?? null,
      note: (row.admin_note as string | null) ?? null,
      rewardedAt: (row.rewarded_at as string | null) ?? null,
      periodType: String(season?.type ?? ""),
      periodLabel: String(season?.label ?? "Leaderboard"),
      startsAt: (season?.starts_at as string | null) ?? null,
      endsAt: (season?.ends_at as string | null) ?? null,
    };
  });

  return Response.json({ rewards }, { headers: { "Cache-Control": "private, no-store" } });
}
