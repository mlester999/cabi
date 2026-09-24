import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { InitialsAvatar, RankBadge, RankProgressBar } from "@/components/ranking/rank-badge";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { achievementCopy, type AchievementCode } from "@/lib/ranking/achievements";
import { rankProgress, tierByNumber } from "@/lib/ranking/tiers";
import { readPublicProfile } from "@/lib/profiles/service";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { getAppAccess } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

/**
 * Public profile.
 *
 * Shows the safe projection only: handle, avatar, rank, season XP, placement,
 * lifetime totals, and permanent achievements. No wallet address, no memories,
 * no conversations, no admin fields - the projection is defined in SQL so this
 * page cannot widen it by accident.
 *
 * `noindex` because a member's progression is theirs to share, not something
 * search engines should index on their behalf.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `${username} - Cabi`,
    description: `Rank and progression for ${username} on Cabi.`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: Params) {
  // Public profiles publish rank, which is not shipping yet, so the route is
  // closed rather than showing a profile with no meaningful content.
  const flags = await readFeatureFlags();
  if (!flags.leaderboard_enabled) return <LockedFeatureScreen flagKey="leaderboard_enabled" />;

  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();

  const { username } = await params;
  const profile = await readPublicProfile(username);
  // An unknown, unpublished, or ineligible handle is a genuine 404 rather than
  // an empty page, so the route cannot be used to probe for account existence.
  if (!profile) notFound();

  const tier = tierByNumber(profile.tier);
  const progress = rankProgress(profile.seasonXp);

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3">
          <Link href="/leaderboard" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to the leaderboard">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="min-w-0 truncate text-xl font-bold tracking-[-0.02em]">{profile.username}</h1>
        </header>

        <section className="glass mt-6 rounded-[26px] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <InitialsAvatar initials={profile.initials} size={64} label={`${profile.username} avatar`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold text-white">{profile.username}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <RankBadge tier={tier} />
                {profile.seasonLabel ? <span className="text-[11px] text-[#777180]">{profile.seasonLabel}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">This season</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white">{profile.seasonXp.toLocaleString()} XP</p>
              </div>
              <p className="text-right text-[11px] leading-5 text-[#a8a3b3]">
                {profile.placement ? <><span className="font-mono text-white">#{profile.placement}</span><br /></> : null}
                {progress.next ? `${progress.toNext.toLocaleString()} XP to ${progress.next.label}` : "Top tier"}
              </p>
            </div>
            <div className="mt-3">
              <RankProgressBar percent={progress.percent} accent={tier.accent} label={`Progress toward ${progress.next?.label ?? tier.label}`} />
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="glass rounded-[22px] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">Lifetime</p>
            <p className="mt-2 font-mono text-xl font-bold text-white">{profile.lifetimeXp.toLocaleString()} XP</p>
            {profile.bestLeaderboardPosition ? (
              <p className="mt-1 text-[11px] text-[#a8a3b3]">Best finish #{profile.bestLeaderboardPosition}</p>
            ) : null}
          </div>
          <div className="glass rounded-[22px] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">On Cabi since</p>
            <p className="mt-2 text-base font-semibold text-white">
              {profile.joinedAt ? new Date(profile.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Recently"}
            </p>
            {profile.bestRankTier ? (
              <p className="mt-1 text-[11px] text-[#a8a3b3]">Best rank {tierByNumber(profile.bestRankTier).label}</p>
            ) : null}
          </div>
        </section>

        {profile.achievements.length > 0 ? (
          <section className="glass mt-4 rounded-[22px] p-5">
            <h2 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">Achievements</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {profile.achievements.map((code) => (
                <li key={code} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-violet-100">
                  {achievementCopy[code as AchievementCode]?.label ?? code}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {profile.showBondPublicly ? (
          <p className="mt-4 text-center text-[11px] text-[#625d6d]">This member shares their Cabi bond badge.</p>
        ) : null}

        <p className="mt-6 text-center text-[11px] leading-6 text-[#625d6d]">
          Rank is earned from real product activity. Wallet addresses are never shown.
        </p>
      </div>
    </main>
  );
}