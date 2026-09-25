import { readBondProfile } from "@/lib/bond-profile";
import { readRankThresholds, readSeason, readSeasonHistory, readStanding } from "@/lib/ranking/service";
import { rankProgress } from "@/lib/ranking/tiers";
import { readProfile } from "@/lib/profiles/service";
import { readAchievements } from "@/lib/ranking/achievements";
import { countWalletMessages } from "@/lib/ranking/message-count";
import { initialsFor } from "@/lib/profiles/username";
import { avatarBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { featureGate } from "@/lib/config/feature-gate";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's full progression: rank, lifetime totals, season history,
 * and bond. Scoped to the session wallet, so there is no parameter that could
 * request another account's data.
 *
 * This is the authoritative source for the profile page and the chat header
 * badge. It is read-only; nothing a browser sends can change a score.
 */
export async function GET() {
  const locked = await featureGate("ranking_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const walletAccountId = auth.identity.walletAccountId;
  const [profile, weekly, monthly, history, bond, achievements, monthlySeason, thresholds] = await Promise.all([
    readProfile(walletAccountId),
    readStanding(walletAccountId, "WEEKLY"),
    readStanding(walletAccountId, "MONTHLY"),
    readSeasonHistory(walletAccountId, 12),
    readBondProfile(walletAccountId, auth.identity.profileId),
    readAchievements(walletAccountId),
    readSeason("MONTHLY"),
    readRankThresholds(),
  ]);

  // Message totals are a lifetime stat. Ownership lives on `conversations`, so
  // this is derived through it rather than by filtering messages directly.
  const messageCount = await countWalletMessages(walletAccountId, "user");
  const avatarUrl = profile?.avatarPath ? await signedImageUrl(avatarBucket, profile.avatarPath) : null;

  return Response.json(
    {
      connected: true,
      profileComplete: Boolean(profile?.profileCompletedAt && profile.username),
      identity: {
        username: profile?.username ?? null,
        displayName: profile?.displayName ?? null,
        initials: profile?.username ? initialsFor(profile.username) : null,
        avatarPath: profile?.avatarPath ?? null,
        avatarUrl,
        joinedAt: profile?.createdAt ?? null,
        rankingStatus: profile?.rankingStatus ?? "NORMAL",
      },
      monthly: monthly
        ? { xp: monthly.xp, placement: monthly.placement, participants: monthly.participants, tier: monthly.tier, progress: monthly.progress, seasonLabel: monthlySeason?.label ?? null }
        : null,
      weekly: weekly
        ? { xp: weekly.xp, placement: weekly.placement, participants: weekly.participants, tier: weekly.tier, progress: weekly.progress }
        : null,
      lifetime: {
        xp: profile?.lifetimeXp ?? 0,
        messages: messageCount,
        bestTier: profile?.bestRankTier ?? null,
        bestPlacement: profile?.bestLeaderboardPosition ?? null,
        seasons: history.length,
      },
      history,
      // Permanent, unlike rank which resets with the season.
      achievements,
      bond: { level: bond.level, label: bond.label, progress: bond.progress, conversationDays: bond.conversationDays, memoryCount: bond.memoryCount },
      // Lifetime XP drives rank. Period XP is shown only on the boards.
      progress: rankProgress(profile?.lifetimeXp ?? 0, thresholds),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
