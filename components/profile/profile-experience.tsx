"use client";

import Link from "@/components/prelaunch/preview-link";
import { useCallback, useEffect, useState } from "react";
import { Award, Calendar, Flame, Images, Lock, Sparkles, Trophy } from "lucide-react";

import { InitialsAvatar, RankBadge, RankProgressBar } from "@/components/ranking/rank-badge";
import { LockedFeatureCard } from "@/components/features/locked-feature";
import { MyCabiImages } from "@/components/profile/my-cabi-images";
import { ShareRankCard } from "@/components/ranking/share-rank-card";
import { ProfileBadgeChip } from "@/components/profile/profile-badge-chip";
import type { RankTier } from "@/lib/ranking/tiers";

type Progress = { current: RankTier; next: RankTier | null; xp: number; toNext: number; percent: number };
type Standing = { xp: number; placement: number | null; participants: number; tier: RankTier; progress: Progress; seasonLabel?: string | null } | null;
type History = { type: string; label: string; xp: number; tier: RankTier; placement: number | null; status: string };
type ProfileBadge = { id: string; slug: string; label: string; description: string; icon: string; color: string; awardedAt: string; isShowcased: boolean };
type Payload = {
  identity: { username: string | null; displayName: string | null; initials: string | null; avatarUrl: string | null; joinedAt: string | null; rankingStatus: string };
  monthly: Standing;
  weekly: Standing;
  lifetime: { xp: number; messages: number; bestTier: number | null; bestPlacement: number | null; seasons: number };
  history: History[];
  achievements: Array<{ code: string; label: string; description: string; awardedAt: string }>;
  profileBadges: ProfileBadge[];
  profileBadgesAvailable: boolean;
  bond: { level: number; label: string; progress: number; conversationDays: number; memoryCount: number };
  progress: Progress;
};

type ProfileOnlyPayload = {
  profileComplete?: boolean;
  profile?: {
    username: string | null;
    displayName: string | null;
    initials: string | null;
    avatarUrl: string | null;
  } | null;
};

/**
 * The signed-in user's progression.
 *
 * Every number here comes from the server. The client never computes XP, a tier,
 * or a placement - if this page were tampered with it could only mislead its own
 * viewer, never the leaderboard.
 */
export function ProfileExperience({ rankingEnabled = true, achievementsEnabled = true }: { rankingEnabled?: boolean; achievementsEnabled?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [profileOnly, setProfileOnly] = useState<ProfileOnlyPayload["profile"]>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [showcaseBadgeIds, setShowcaseBadgeIds] = useState<string[] | null>(null);
  const [badgeNotice, setBadgeNotice] = useState<string | null>(null);
  const [savingBadges, setSavingBadges] = useState(false);
  const selectedBadgeIds = showcaseBadgeIds ?? data?.profileBadges?.filter((badge) => badge.isShowcased).map((badge) => badge.id) ?? [];
  const profileRoadmapPreviews = achievementsEnabled ? [] : ["achievements_enabled" as const];

  const load = useCallback(async () => {
    try {
      const response = await fetch(rankingEnabled ? "/api/rank" : "/api/profile", { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      if (rankingEnabled) {
        setData(await response.json() as Payload);
        setProfileOnly(null);
      } else {
        const payload = await response.json() as ProfileOnlyPayload;
        setProfileOnly(payload.profile ?? null);
        setData(null);
      }
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [rankingEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const saveBadgeShowcase = async () => {
    setSavingBadges(true);
    setBadgeNotice(null);
    try {
      const response = await fetch("/api/profile/badges", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ badgeIds: selectedBadgeIds }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setBadgeNotice(payload.error ?? "I couldn't save your badge selection."); return; }
      setShowcaseBadgeIds(selectedBadgeIds);
      setData((current) => current ? { ...current, profileBadges: (current.profileBadges ?? []).map((badge) => ({ ...badge, isShowcased: selectedBadgeIds.includes(badge.id) })) } : current);
      setBadgeNotice("Your profile badge selection is saved.");
    } catch {
      setBadgeNotice("I couldn't save your badge selection. Try again.");
    } finally {
      setSavingBadges(false);
    }
  };

  if (phase === "loading") return <p className="mt-10 text-center text-sm text-[#a8a3b3]" role="status">Loading your profile...</p>;
  if (phase === "error" || !data) {
    if (phase === "ready" && !rankingEnabled) {
      return (
        <div className="mt-8 space-y-5">
          <section className="glass rounded-[26px] p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-4">
              <InitialsAvatar initials={profileOnly?.initials ?? "?"} src={profileOnly?.avatarUrl} size={64} label={`${profileOnly?.username ?? "You"} avatar`} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Your identity</p>
                <h2 className="mt-1 truncate text-lg font-bold text-white">{profileOnly?.username ?? "Unnamed"}</h2>
                <p className="mt-1.5 text-xs leading-5 text-[#a8a3b3]">Your name and optional photo are ready to travel with you.</p>
              </div>
              <Link href="/settings" className="focus-ring inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06]">Edit profile</Link>
            </div>
          </section>

          <section className="glass rounded-[22px] p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]"><Lock size={12} aria-hidden="true" /> Community progression</div>
            <h2 className="mt-3 text-base font-semibold text-white">Rank progress is temporarily unavailable.</h2>
            <p className="mt-2 text-sm leading-6 text-[#a8a3b3]">There is no placeholder rank, score, or leaderboard row while progression is unavailable.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {profileRoadmapPreviews.map((flag) => <LockedFeatureCard key={flag} flagKey={flag} />)}
            </div>
            <Link href="/lab" className="focus-ring mt-4 inline-flex h-10 items-center rounded-xl border border-violet-200/[0.14] bg-violet-300/[0.05] px-4 text-xs font-semibold text-violet-100 hover:bg-violet-300/[0.09]">Explore Cabi</Link>
          </section>

          <section className="glass rounded-[22px] p-5">
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]"><Images size={12} aria-hidden="true" /> My Cabi images</h3>
            <MyCabiImages />
          </section>
        </div>
      );
    }
    return (
      <div className="glass mt-10 rounded-[26px] p-8 text-center">
        <p className="text-sm text-[#d5d0de]">I could not load your profile just now.</p>
        <button type="button" onClick={() => void load()} className="focus-ring mt-5 inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold">Try again</button>
      </div>
    );
  }

  const { identity, monthly, weekly, lifetime, history, bond, progress, achievements } = data;
  const profileBadges = data.profileBadges ?? [];
  const profileBadgesAvailable = data.profileBadgesAvailable ?? false;

  return (
    <div className="mt-8 space-y-5">
      <section className="glass rounded-[26px] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <InitialsAvatar initials={identity.initials ?? "?"} src={identity.avatarUrl} size={64} label={`${identity.username ?? "You"} avatar`} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">{identity.username ?? "Unnamed"}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <RankBadge tier={progress.current} />
              {identity.joinedAt ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#777180]">
                  <Calendar size={11} aria-hidden="true" />
                  Joined {new Date(identity.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {identity.username ? (
              <ShareRankCard input={{
                username: identity.username,
                tier: progress.current,
                lifetimeXp: lifetime.xp,
                weeklyPlacement: weekly?.placement ?? null,
              }} />
            ) : null}
            <Link href="/settings" className="focus-ring inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
              Edit profile
            </Link>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Lifetime rank</p>
              <p className="mt-1 font-mono text-2xl font-bold text-white">{lifetime.xp.toLocaleString()} XP</p>
            </div>
            {progress.next ? (
              <p className="text-right text-[11px] leading-5 text-[#a8a3b3]">
                Next: <span className="font-semibold text-white">{progress.next.label}</span>
                <br />
                {progress.toNext.toLocaleString()} XP to {progress.next.label} · {progress.xp.toLocaleString()} / {progress.next.threshold.toLocaleString()} XP
              </p>
            ) : (
              <p className="text-right text-[11px] text-amber-200">Top tier reached</p>
            )}
          </div>
          <div className="mt-3"><RankProgressBar percent={progress.percent} accent={progress.current.accent} label={`Progress toward ${progress.next?.label ?? progress.current.label}`} /></div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="glass rounded-[22px] p-5">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]"><Trophy size={12} aria-hidden="true" /> Weekly</p>
          <p className="mt-2 font-mono text-xl font-bold text-white">{(weekly?.xp ?? 0).toLocaleString()} XP</p>
          <p className="mt-1 text-[11px] text-[#a8a3b3]">
            {weekly?.placement ? `#${weekly.placement} of ${weekly.participants}` : "Not placed yet this week"}
          </p>
          <Link href="/leaderboard" className="focus-ring mt-3 inline-block text-[11px] font-semibold text-violet-200 hover:text-white">View leaderboard</Link>
        </div>
        <div className="glass rounded-[22px] p-5">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]"><Sparkles size={12} aria-hidden="true" /> Monthly board</p>
          <p className="mt-2 font-mono text-xl font-bold text-white">{(monthly?.xp ?? 0).toLocaleString()} XP</p>
          <p className="mt-1 text-[11px] text-[#a8a3b3]">{monthly?.placement ? `#${monthly.placement} of ${monthly.participants}` : "Not placed yet this month"}</p>
          <Link href="/leaderboard" className="focus-ring mt-3 inline-block text-[11px] font-semibold text-violet-200 hover:text-white">View leaderboard</Link>
        </div>
      </section>

      <section className="glass rounded-[22px] p-5">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]"><Flame size={12} aria-hidden="true" /> Bond with Cabi</p>
        <p className="mt-2 text-base font-bold text-white">{bond.label}</p>
        <div className="mt-3"><RankProgressBar percent={bond.progress} accent="#c4b5fd" label={`Bond progress, level ${bond.level}`} /></div>
        <p className="mt-2 text-[11px] text-[#a8a3b3]">
          {bond.conversationDays} day{bond.conversationDays === 1 ? "" : "s"} together - {bond.memoryCount} memories
        </p>
        <p className="mt-2 text-[11px] leading-5 text-[#625d6d]">Bond is separate from rank and never resets.</p>
      </section>

      <section className="glass rounded-[22px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">Profile badges</h3>
            <p className="mt-2 text-[11px] leading-5 text-[#8e889b]">Badges are awarded by the Cabi team and are separate from achievements. Showcase up to three.</p>
          </div>
          {profileBadgesAvailable && profileBadges.length > 0 ? <span className="text-[10px] text-[#777180]">{selectedBadgeIds.length} of 3 selected</span> : null}
        </div>
        {!profileBadgesAvailable ? <p className="mt-4 text-xs text-[#a8a3b3]">Profile badges are temporarily unavailable.</p> : null}
        {profileBadgesAvailable && profileBadges.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-center text-xs text-[#8e889b]">No profile badges have been awarded yet.</p> : null}
        {profileBadgesAvailable && profileBadges.length > 0 ? <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {profileBadges.map((badge) => {
              const selected = selectedBadgeIds.includes(badge.id);
              const disabled = !selected && selectedBadgeIds.length >= 3;
              return <button key={badge.id} type="button" aria-pressed={selected} disabled={disabled} onClick={() => setShowcaseBadgeIds((current) => { const ids = current ?? profileBadges.filter((item) => item.isShowcased).map((item) => item.id); return selected ? ids.filter((id) => id !== badge.id) : [...ids, badge.id]; })} className={`focus-ring flex min-h-[68px] items-start gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "border-violet-200/[0.18] bg-violet-300/[0.06]" : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]"}`}>
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-white/[0.12] text-[10px] text-violet-100">{selected ? "✓" : ""}</span>
                <span className="min-w-0"><ProfileBadgeChip badge={badge} /><span className="mt-1.5 block text-[10px] leading-4 text-[#8e889b]">{badge.description || "A badge awarded by the Cabi team."}</span></span>
              </button>;
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {badgeNotice ? <p role="status" className="text-[11px] text-violet-100">{badgeNotice}</p> : <span />}
            <button type="button" onClick={() => void saveBadgeShowcase()} disabled={savingBadges} className="focus-ring h-9 rounded-xl border border-violet-200/[0.14] bg-violet-300/[0.06] px-3 text-[11px] font-semibold text-violet-100 hover:bg-violet-300/[0.1] disabled:opacity-40">{savingBadges ? "Saving…" : "Save showcase"}</button>
          </div>
        </> : null}
      </section>

      {achievementsEnabled && achievements.length > 0 ? (
        <section className="glass rounded-[22px] p-5">
          <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">
            <Award size={12} aria-hidden="true" /> Achievements
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {achievements.map((achievement) => (
              <li key={achievement.code} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
                <p className="text-[12px] font-semibold text-white">{achievement.label}</p>
                <p className="mt-0.5 text-[11px] leading-5 text-[#8e889b]">{achievement.description}</p>
              </li>
            ))}
          </ul>
          {/* Permanent, unlike rank. */}
          <p className="mt-3 text-[11px] text-[#625d6d]">Achievements are kept forever. Weekly and monthly XP reset; lifetime XP and rank stay with you.</p>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="glass overflow-hidden rounded-[22px]">
          <h3 className="border-b border-white/[0.05] px-5 py-3.5 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">Season history</h3>
          <ul className="divide-y divide-white/[0.05]">
            {history.map((season, index) => (
              <li key={`${season.label}-${index}`} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{season.label}</span>
                <RankBadge tier={season.tier} size="sm" />
                <span className="w-16 shrink-0 text-right font-mono text-[12px] text-violet-200">{season.xp.toLocaleString()}</span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-[#777180]">{season.placement ? `#${season.placement}` : "-"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* My Cabi Images: a small authenticated list, not a gallery. */}
      <section className="glass rounded-[22px] p-5">
        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#777180]">
          <Images size={12} aria-hidden="true" /> My Cabi images
        </h3>
        <MyCabiImages />
      </section>

      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Link href="/settings/memory" className="focus-ring inline-flex h-11 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
          Memory
        </Link>
      </div>
    </div>
  );
}
