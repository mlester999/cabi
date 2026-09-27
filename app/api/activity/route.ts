import { getServiceClient } from "@/lib/db/supabase";
import { achievementCopy, type AchievementCode } from "@/lib/ranking/achievements";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/** Private activity feed assembled from durable server-side product records. */
export async function GET() {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return Response.json({ error: "Activity isn't available right now." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });

  const walletAccountId = auth.identity.walletAccountId;
  const [xpRows, achievementRows, rewardRows, imageRows, memoryRows, readState] = await Promise.all([
    db.from("rank_xp_events").select("id,xp_delta,event_type,reason_code,created_at").eq("wallet_account_id", walletAccountId).gt("xp_delta", 0).order("created_at", { ascending: false }).limit(30),
    db.from("profile_achievements").select("code,awarded_at").eq("wallet_account_id", walletAccountId).order("awarded_at", { ascending: false }).limit(30),
    db.from("rank_reward_snapshots").select("id,placement,reward_status,reward_amount,created_at,rewarded_at,rank_seasons(type,label)").eq("wallet_account_id", walletAccountId).order("created_at", { ascending: false }).limit(20),
    db.from("image_generations").select("id,created_at").eq("wallet_account_id", walletAccountId).eq("status", "COMPLETED").order("created_at", { ascending: false }).limit(20),
    db.from("user_memories").select("id,created_at").eq("wallet_account_id", walletAccountId).order("created_at", { ascending: false }).limit(20),
    db.from("cabi_activity_read_state").select("last_read_at").eq("wallet_account_id", walletAccountId).maybeSingle(),
  ]);

  const failed = [xpRows, achievementRows, rewardRows, imageRows, memoryRows, readState].some((result) => result.error);
  if (failed) return Response.json({ error: "Activity isn't available right now." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });

  const allItems = [
    ...((xpRows.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: `xp:${String(row.id)}`, type: "XP", title: `+${Number(row.xp_delta)} XP`, detail: String(row.reason_code ?? row.event_type).replaceAll("_", " ").toLowerCase(), createdAt: String(row.created_at),
    })),
    ...((achievementRows.data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
      const code = String(row.code) as AchievementCode;
      const copy = achievementCopy[code];
      return copy ? [{ id: `achievement:${code}`, type: "ACHIEVEMENT", title: copy.label, detail: copy.description, createdAt: String(row.awarded_at) }] : [];
    }),
    ...((rewardRows.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const season = (Array.isArray(row.rank_seasons) ? row.rank_seasons[0] : row.rank_seasons) as Record<string, unknown> | null;
      const status = String(row.reward_status);
      return {
        id: `reward:${String(row.id)}`, type: "REWARD",
        title: status === "REWARDED" ? "Reward distributed" : status === "SKIPPED" ? "Reward closed" : "Reward pending",
        detail: `${String(season?.label ?? "Leaderboard")} · place #${Number(row.placement)}${row.reward_amount == null ? "" : ` · ${String(row.reward_amount)} $CPU`}`,
        createdAt: String(row.rewarded_at ?? row.created_at),
      };
    }),
    ...((imageRows.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: `image:${String(row.id)}`, type: "IMAGE", title: "Cabi made an image", detail: "A new Cabi image was saved to your collection.", createdAt: String(row.created_at) })),
    ...((memoryRows.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: `memory:${String(row.id)}`, type: "MEMORY", title: "A memory was saved", detail: "Cabi can use this detail in future conversations.", createdAt: String(row.created_at) })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100);
  const lastReadAt = readState.data?.last_read_at ? new Date(String(readState.data.last_read_at)).getTime() : Number.NEGATIVE_INFINITY;
  const items = allItems.map((item) => ({ ...item, isRead: new Date(item.createdAt).getTime() <= lastReadAt }));
  const unreadCount = items.filter((item) => !item.isRead).length;

  return Response.json({ items, unreadCount }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Marks the signed-in wallet's activity feed as read through the server time. */
export async function POST(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Activity isn't available right now.", 503, "DATABASE_NOT_CONFIGURED");

  const now = new Date().toISOString();
  const { error } = await db.from("cabi_activity_read_state").upsert({
    wallet_account_id: auth.identity.walletAccountId,
    last_read_at: now,
    updated_at: now,
  }, { onConflict: "wallet_account_id" });
  if (error) return jsonError("I couldn't update your activity status.", 503, "ACTIVITY_READ_FAILED");
  return Response.json({ ok: true, lastReadAt: now }, { headers: { "Cache-Control": "private, no-store" } });
}
