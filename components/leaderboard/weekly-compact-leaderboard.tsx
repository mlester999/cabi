"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/prelaunch/preview-link";
import { InitialsAvatar } from "@/components/ranking/rank-badge";
import { SeasonCountdown } from "@/components/ranking/season-countdown";
import { initialsFor } from "@/lib/profiles/username";
import type { RankTier } from "@/lib/ranking/tiers";

type Entry = { placement: number; username: string; xp: number; tier: RankTier; isCurrentUser: boolean };
type Payload = {
  available: boolean;
  season: { endsAt: string } | null;
  entries: Entry[];
  standing: { placement: number | null; xp: number } | null;
  you: Entry | null;
  currentUser?: { username: string | null; displayName: string | null } | null;
};

/** Small, poll-light weekly board sized for the existing Cabi presence panel. */
export function WeeklyCompactLeaderboard({ authenticated }: { authenticated: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/leaderboard?type=WEEKLY", { cache: "no-store" });
      if (!response.ok) throw new Error("Leaderboard unavailable");
      const payload = await response.json() as Payload;
      setData(payload);
      setFailed(!payload.available);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 45_000);
    const refresh = () => void load();
    window.addEventListener("cabi:xp-awarded", refresh);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      window.removeEventListener("cabi:xp-awarded", refresh);
    };
  }, [load]);

  const leaders = (data?.entries ?? []).filter((entry) => entry.placement <= 5);
  const you = data?.you ?? null;
  const yourStanding = data?.standing ?? null;
  const yourName = you?.username ?? data?.currentUser?.displayName ?? data?.currentUser?.username ?? "You";

  return (
    <section className="rounded-2xl border border-violet-200/[0.08] bg-[#0c0914]/55 px-3.5 py-3" aria-labelledby="weekly-mini-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="weekly-mini-heading" className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#d5d0de]">Weekly leaderboard</h2>
        {data?.season ? <SeasonCountdown endsAt={data.season.endsAt} compact onElapsed={() => void load()} /> : <span className="h-3 w-16 animate-pulse rounded bg-white/[0.06]" aria-hidden="true" />}
      </div>

      {!data && !failed ? (
        <div className="mt-3 space-y-2" role="status" aria-label="Loading weekly leaderboard">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-7 items-center gap-2"><span className="h-3 w-4 animate-pulse rounded bg-white/[0.06]" /><span className="h-5 w-5 animate-pulse rounded-full bg-white/[0.06]" /><span className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" /><span className="h-3 w-12 animate-pulse rounded bg-white/[0.06]" /></div>)}
        </div>
      ) : null}

      {failed ? <p className="mt-3 text-[11px] leading-5 text-[#8e889b]">Leaderboard is unavailable right now.</p> : null}

      {data?.available && leaders.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-[12px] font-medium text-[#d5d0de]">No one&apos;s on the board yet.</p>
          <p className="mt-1 text-[10px] leading-4 text-[#8e889b]">Chat with Cabi and be the first.</p>
        </div>
      ) : null}

      {leaders.length > 0 ? (
        <ol className="mt-2.5 divide-y divide-white/[0.045]">
          {leaders.map((entry) => {
            const placeColor = entry.placement === 1 ? "text-amber-200" : entry.placement === 2 ? "text-slate-200" : entry.placement === 3 ? "text-orange-200" : "text-[#777180]";
            return (
              <li key={entry.placement} className={`flex h-9 items-center gap-2 rounded-lg px-1.5 ${entry.isCurrentUser ? "bg-violet-300/[0.07]" : ""}`}>
                <span className={`w-5 shrink-0 text-center font-mono text-[11px] font-semibold ${placeColor}`}>{entry.placement}</span>
                <InitialsAvatar initials={initialsFor(entry.username)} size={22} label={`${entry.username} avatar`} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#e5e1eb]">{entry.username}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-violet-200">{entry.xp.toLocaleString()} XP</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {authenticated && yourStanding && (!you || you.placement > 5) ? (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-[.15em] text-[#777180]">Your position</p>
          <div className="flex items-center gap-2 rounded-lg bg-violet-300/[0.045] px-1.5 py-1.5">
            <span className="w-5 shrink-0 text-center font-mono text-[11px] font-semibold text-violet-200">{yourStanding.placement ? `#${yourStanding.placement}` : "—"}</span>
            <InitialsAvatar initials={initialsFor(yourName)} size={22} label={`${yourName} avatar`} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">{yourName}</span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-violet-200">{yourStanding.xp.toLocaleString()} XP</span>
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t border-white/[0.06] pt-2.5">
        <p className="text-[10px] font-medium text-[#d5d0de]">How it works</p>
        <p className="mt-1 text-[10px] leading-4 text-[#8e889b]">Meaningful activity earns XP. Spam doesn&apos;t.</p>
        <p className="text-[10px] leading-4 text-[#8e889b]">Weekly XP resets. Your rank doesn&apos;t.</p>
        <Link href="/leaderboard" className="focus-ring mt-2 inline-flex min-h-8 items-center justify-center rounded-lg border border-violet-200/[0.12] bg-violet-300/[0.055] px-3 text-[10px] font-semibold text-violet-100 hover:bg-violet-300/[0.1]">View leaderboard</Link>
      </div>
    </section>
  );
}
