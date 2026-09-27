import { achievementCodes, achievementCopy, readAchievements, refreshAchievements } from "@/lib/ranking/achievements";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/** Private achievement catalogue and earned milestones for the session wallet. */
export async function GET() {
  const locked = await featureGate("achievements_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  await refreshAchievements(auth.identity.walletAccountId).catch(() => []);
  const earned = await readAchievements(auth.identity.walletAccountId);
  const earnedByCode = new Map(earned.map((item) => [item.code, item.awardedAt]));
  const achievements = achievementCodes.map((code) => ({
    code,
    ...achievementCopy[code],
    earned: earnedByCode.has(code),
    awardedAt: earnedByCode.get(code) ?? null,
  }));

  return Response.json({ achievements }, { headers: { "Cache-Control": "private, no-store" } });
}
