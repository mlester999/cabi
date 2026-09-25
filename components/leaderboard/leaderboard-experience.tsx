"use client";

import { useCallback, useEffect, useState } from "react";

import { InitialsAvatar, RankBadge, RankProgressBar } from "@/components/ranking/rank-badge";
import { SeasonCountdown } from "@/components/ranking/season-countdown";
import { initialsFor } from "@/lib/profiles/username";
import { rankTiers, type RankTier } from "@/lib/ranking/tiers";

type Entry = { placement: number; username: string; avatarPath: string | null; xp: number; tier: RankTier; isCurrentUser: boolean };
type Season = { id: string; label: string; startsAt: string; endsAt: string; msRemaining: number } | null;
type Standing = { placement: number | null; xp: number; participants: number; tier: RankTier } | null;
type Payload = { type: "WEEKLY" | "MONTHLY"; season: Season; available: boolean; entries: Entry[]; standing: Standing; you: Entry | null; currentUser?: { username: string | null; displayName: string | null } | null };

/**
 * Weekly and monthly leaderboards.
 *
 * Defaults to WEEKLY. There is no placeholder or sample data anywhere in this
 * component: an empty board means nobody has earned XP yet, and it says so.
 */
export function LeaderboardExperience({ wallet }: { wallet: { authenticated: boolean } }) {
  const [tab, setTab] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [data, setData] = useState<Payload | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async (type: "WEEKLY" | "MONTHLY") => {
    setPhase((current) => current === "ready" ? "ready" : "loading");
    try {
      const response = await fetch(`/api/leaderboard?type=${type}`, { cache: "no-store" });
      const payload = await response.json() as (Payload & { error?: string });
      if (!response.ok) { setMessage(payload.error ?? "The leaderboard is unavailable right now."); setPhase("error"); return; }
      setData(payload);
      setPhase("ready");
    } catch {
      setMessage("The leaderboard is unavailable right now.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(tab); }, 0);
    const poll = window.setInterval(() => void load(tab), 45_000);
    const refresh = () => void load(tab);
    window.addEventListener("cabi:xp-awarded", refresh);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener("cabi:xp-awarded", refresh);
    };
  }, [load, tab]);

  const entries = data?.entries ?? [];
  const top = entries.filter((entry) => entry.placement <= 3);
  const rest = entries.filter((entry) => entry.placement > 3 && entry.placement <= 100);
  const you = data?.you ?? null;

  return (
    <section className="mt-6">
      <div className="glass rounded-[26px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-xl border border-white/[0.07] bg-white/[0.02] p-1" role="tablist" aria-label="Leaderboard period">
            {(["WEEKLY", "MONTHLY"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`focus-ring rounded-lg px-3.5 py-1.5 text-[12px] font-semibold uppercase tracking-[.1em] transition ${tab === value ? "bg-violet-300/[0.14] text-white" : "text-[#a8a3b3] hover:text-white"}`}
              >
                {value === "WEEKLY" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-[.14em] text-[#777180]">{data?.season?.label ?? ""}</span>
            {data?.season ? <SeasonCountdown endsAt={data.season.endsAt} onElapsed={() => void load(tab)} /> : null}
          </div>
        </div>

        {/* The signed-in user's own standing, always visible even outside the top 100. */}
        {wallet.authenticated && data?.standing && (data.standing.placement == null || data.standing.placement > 100) ? (
          <div className="mt-4 rounded-2xl border border-violet-200/[0.14] bg-violet-300/[0.05] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-semibold text-violet-200">
                  {data.standing.placement ? `#${data.standing.placement}` : "Unranked"}
                </span>
                <span className="text-[12px] text-white">{data.you?.username ?? data.currentUser?.displayName ?? data.currentUser?.username ?? "You"}</span>
                <RankBadge tier={data.standing.tier} />
                <span className="text-[12px] text-[#a8a3b3]">{data.standing.participants} competing</span>
              </div>
              <span className="font-mono text-[13px] font-semibold text-white">{data.standing.xp.toLocaleString()} XP</span>
            </div>
          </div>
        ) : null}
      </div>

      {phase === "loading" ? (
        <div className="glass mt-6 space-y-2 rounded-[22px] p-4" role="status" aria-label="Loading leaderboard">
          {Array.from({ length: 7 }, (_, index) => <div key={index} className="flex h-10 items-center gap-3"><span className="h-3 w-8 animate-pulse rounded bg-white/[0.06]" /><span className="h-8 w-8 animate-pulse rounded-full bg-white/[0.06]" /><span className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" /><span className="h-3 w-16 animate-pulse rounded bg-white/[0.06]" /></div>)}
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="glass mt-6 rounded-[26px] p-8 text-center">
          <p className="text-sm text-[#d5d0de]">{message}</p>
          <button type="button" onClick={() => void load(tab)} className="focus-ring mt-5 inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold">Try again</button>
        </div>
      ) : null}

      {phase === "ready" && data?.available === false ? (
        <div className="glass mt-6 rounded-[26px] p-8 text-center">
          <p className="text-sm font-semibold text-white">I cannot read the leaderboard right now.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[#a8a3b3]">The ranking store is not reachable. Nothing is wrong with your own progress.</p>
          <button type="button" onClick={() => void load(tab)} className="focus-ring mt-5 inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold">Try again</button>
        </div>
      ) : null}

      {phase === "ready" && data?.available !== false && entries.length === 0 ? (
        <div className="glass mt-6 rounded-[26px] p-8 text-center">
          <p className="text-sm font-semibold text-white">No one&apos;s on the board yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[#a8a3b3]">
            Chat with Cabi and be the first.
          </p>
        </div>
      ) : null}

      {phase === "ready" && top.length > 0 ? (
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {top.map((entry) => (
            <li
              key={entry.username}
              className={`glass rounded-[22px] p-4 text-center ${entry.isCurrentUser ? "ring-1 ring-violet-300/40" : entry.placement === 1 ? "border-amber-200/[0.15]" : entry.placement === 2 ? "border-slate-200/[0.13]" : "border-orange-200/[0.13]"}`}
            >
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[.16em] text-[#777180]">#{entry.placement}</p>
              <div className="mt-3 flex justify-center">
                <InitialsAvatar initials={initialsFor(entry.username)} size={48} label={`${entry.username} avatar`} />
              </div>
              <p className="mt-3 truncate text-sm font-semibold text-white">{entry.username}</p>
              <div className="mt-2 flex justify-center"><RankBadge tier={entry.tier} size="sm" /></div>
              <p className="mt-3 font-mono text-[13px] font-semibold text-violet-200">{entry.xp.toLocaleString()} XP</p>
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "ready" && rest.length > 0 ? (
        <ol className="glass mt-4 divide-y divide-white/[0.05] overflow-hidden rounded-[22px]">
          {rest.map((entry) => (
            <li
              key={entry.username}
              className={`flex items-center gap-3 px-4 py-3 ${entry.isCurrentUser ? "bg-violet-300/[0.07]" : ""}`}
            >
              <span className="w-9 shrink-0 font-mono text-[12px] text-[#777180]">#{entry.placement}</span>
              <InitialsAvatar initials={initialsFor(entry.username)} size={30} label={`${entry.username} avatar`} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{entry.username}</span>
              <RankBadge tier={entry.tier} size="sm" showLabel={false} />
              <span className="w-20 shrink-0 text-right font-mono text-[12px] text-violet-200">{entry.xp.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "ready" && you && you.placement > 100 ? (
        <div className="glass mt-4 flex items-center gap-3 rounded-[22px] px-4 py-3 ring-1 ring-violet-300/40">
          <span className="w-9 shrink-0 font-mono text-[12px] text-violet-200">#{you.placement}</span>
          <InitialsAvatar initials={initialsFor(you.username)} size={30} label={`${you.username} avatar`} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{you.username}</span>
          <span className="w-20 shrink-0 text-right font-mono text-[12px] text-violet-200">{you.xp.toLocaleString()}</span>
        </div>
      ) : null}

      <section className="glass mt-6 rounded-[22px] p-5">
        <h2 className="text-sm font-semibold text-white">How it works</h2>
        <p className="mt-2 text-[12px] leading-6 text-[#a8a3b3]">Earn XP by actually spending time with Cabi. Meaningful chats, memories and other Cabi interactions can earn XP. Spam and repeated messages don&apos;t.</p>
        <p className="mt-2 text-[12px] leading-6 text-[#a8a3b3]">Weekly and monthly boards reset, but your lifetime XP and rank stay with you.</p>
        <p className="mt-2 text-[11px] leading-5 text-[#777180]">Leaderboard rewards are handled manually by the Cabi team.</p>
      </section>
    </section>
  );
}

export { rankTiers };
export { RankProgressBar };
