"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { InitialsAvatar, RankBadge, RankProgressBar } from "@/components/ranking/rank-badge";
import { initialsFor } from "@/lib/profiles/username";
import { tierByNumber, type RankTier } from "@/lib/ranking/tiers";

type Payload = {
  account: {
    walletAccountId: string; walletAddress: string | null; username: string | null; displayName: string | null;
    profileComplete: boolean; rankingStatus: "NORMAL" | "REVIEW" | "INELIGIBLE"; joinedAt: string | null; lastActiveAt: string | null;
  };
  rank: {
    monthly: { xp: number; placement: number | null; participants: number; tier: RankTier; seasonLabel: string | null } | null;
    weekly: { xp: number; placement: number | null; participants: number; tier: RankTier } | null;
    lifetimeXp: number;
    bestTier: RankTier | null;
    bestPlacement: number | null;
  };
  counts: { conversations: number; messages: number; memories: number; images: number };
  bond: { level: number; label: string; progress: number; conversationDays: number };
  achievements: Array<{ code: string; label: string }>;
  history: Array<{ label: string; xp: number; tier: RankTier; placement: number | null }>;
  xpEvents: Array<{ id: number; delta: number; eventType: string; reasonCode: string; createdAt: string }>;
  rewards: Array<{ id: number; placement: number; xp: number; reward_status: string }>;
};

/**
 * Admin account detail.
 *
 * Shows identity and progression. Conversation content is deliberately absent:
 * deciding whether an account is farming needs counts and the XP ledger, not
 * anyone's messages.
 */
export function AdminUserDetail({ walletAccountId }: { walletAccountId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/users/${walletAccountId}`, { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      setData(await response.json() as Payload);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [walletAccountId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const setStatus = async (status: "NORMAL" | "REVIEW" | "INELIGIBLE") => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${walletAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingStatus: status }),
      });
      if (!response.ok) { setNotice("That flag could not be set."); return; }
      setNotice(`Marked ${status}.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") return <p className="p-8 text-sm text-[var(--cabi-text-secondary)]" role="status">Loading account...</p>;
  if (phase === "error" || !data) return <p className="p-8 text-sm text-rose-300">Could not load that account.</p>;

  const { account, rank, counts, bond, achievements, history, xpEvents, rewards } = data;
  const initials = account.username ? initialsFor(account.username) : "?";

  const stat = (label: string, value: string) => (
    <div key={label} className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--cabi-text-faint)]">{label}</p>
      <p className="mt-1 font-mono text-[15px] font-semibold text-white">{value}</p>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1000px] p-5 sm:p-8">
      <Link href="/admin/users" className="focus-ring inline-flex items-center gap-2 text-xs font-semibold text-[var(--cabi-text-muted)] hover:text-white">
        <ArrowLeft size={14} aria-hidden="true" /> All users
      </Link>

      {notice ? <p role="status" className="mt-4 rounded-xl border border-violet-200/[0.16] bg-violet-300/[0.06] px-3 py-2 text-xs text-[var(--cabi-text-secondary)]">{notice}</p> : null}

      <header className="mt-5 flex flex-wrap items-center gap-4">
        <InitialsAvatar initials={initials} size={56} label="Account avatar" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-[-0.02em]">{account.username ?? "Unnamed account"}</h1>
          <p className="mt-1 font-mono text-[11px] text-[var(--cabi-text-muted)]">{account.walletAddress ?? account.walletAccountId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rank.monthly ? <RankBadge tier={rank.monthly.tier} /> : null}
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] ${account.rankingStatus === "NORMAL" ? "bg-emerald-300/[0.12] text-emerald-200" : "bg-amber-200/[0.14] text-amber-100"}`}>
            {account.rankingStatus}
          </span>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stat("Monthly XP", (rank.monthly?.xp ?? 0).toLocaleString())}
        {stat("Weekly XP", (rank.weekly?.xp ?? 0).toLocaleString())}
        {stat("Lifetime XP", rank.lifetimeXp.toLocaleString())}
        {stat("Placement", rank.monthly?.placement ? `#${rank.monthly.placement}` : "-")}
        {stat("Bond", bond.label)}
        {stat("Messages", counts.messages.toLocaleString())}
        {stat("Conversations", counts.conversations.toLocaleString())}
        {stat("Memories", counts.memories.toLocaleString())}
        {stat("Images", counts.images.toLocaleString())}
        {stat("Joined", account.joinedAt ? new Date(account.joinedAt).toLocaleDateString() : "-")}
        {stat("Last active", account.lastActiveAt ? new Date(account.lastActiveAt).toLocaleDateString() : "-")}
        {stat("Best finish", rank.bestPlacement ? `#${rank.bestPlacement}` : "-")}
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">Season progress</h2>
        <p className="mt-1.5 text-[11px] text-[var(--cabi-text-muted)]">{rank.monthly?.seasonLabel ?? "No active season"}</p>
        <div className="mt-3">
          <RankProgressBar percent={rank.monthly ? Math.min(100, Math.round((rank.monthly.xp / Math.max(1, rank.monthly.xp + 1)) * 100)) : 0} accent={rank.monthly?.tier.accent ?? "#777181"} label="Season progress" />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ShieldAlert size={15} className="text-amber-200" aria-hidden="true" /> Leaderboard eligibility</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          A flagged account keeps full chat access. It only stops appearing on the reward leaderboard. Every change is audited.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["NORMAL", "REVIEW", "INELIGIBLE"] as const).map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy || account.rankingStatus === status}
              onClick={() => void setStatus(status)}
              className={`focus-ring h-9 rounded-xl px-3.5 text-[11px] font-semibold disabled:opacity-40 ${account.rankingStatus === status ? "bg-violet-300/[0.14] text-white" : "border border-[var(--cabi-border)] text-[var(--cabi-text-secondary)] hover:bg-[var(--cabi-surface-2)]"}`}
            >
              {status}
            </button>
          ))}
        </div>
      </section>

      {xpEvents.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)]">
          <h2 className="border-b border-[var(--cabi-hairline)] px-5 py-3.5 text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--cabi-text-muted)]">XP history (latest {xpEvents.length})</h2>
          <ul className="divide-y divide-white/[0.05]">
            {xpEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className={`w-12 font-mono text-[12px] font-semibold ${event.delta > 0 ? "text-emerald-200" : event.delta < 0 ? "text-rose-200" : "text-[var(--cabi-text-muted)]"}`}>
                  {event.delta > 0 ? "+" : ""}{event.delta}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--cabi-text-secondary)]">{event.eventType}</span>
                <span className="hidden shrink-0 text-[11px] text-[var(--cabi-text-faint)] sm:block">{event.reasonCode}</span>
                <span className="shrink-0 text-[11px] text-[var(--cabi-text-faint)]">{new Date(event.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)]">
          <h2 className="border-b border-[var(--cabi-hairline)] px-5 py-3.5 text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--cabi-text-muted)]">Leaderboard history</h2>
          <ul className="divide-y divide-white/[0.05]">
            {history.map((season, index) => (
              <li key={`${season.label}-${index}`} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-white">{season.label}</span>
                <RankBadge tier={tierByNumber(season.tier.tier)} size="sm" />
                <span className="w-20 text-right font-mono text-[12px] text-[var(--cabi-primary)]">{season.xp.toLocaleString()}</span>
                <span className="w-12 text-right font-mono text-[11px] text-[var(--cabi-text-faint)]">{season.placement ? `#${season.placement}` : "-"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rewards.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)]">
          <h2 className="border-b border-[var(--cabi-hairline)] px-5 py-3.5 text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--cabi-text-muted)]">Reward snapshots</h2>
          <ul className="divide-y divide-white/[0.05]">
            {rewards.map((reward) => (
              <li key={reward.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="font-mono text-[12px] text-[var(--cabi-text-muted)]">#{reward.placement}</span>
                <span className="min-w-0 flex-1 font-mono text-[12px] text-[var(--cabi-primary)]">{reward.xp.toLocaleString()} XP</span>
                <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-amber-100">{reward.reward_status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {achievements.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--cabi-text-muted)]">Achievements</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {achievements.map((achievement) => (
              <li key={achievement.code} className="rounded-full border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-3 py-1.5 text-[11px] text-[var(--cabi-text-secondary)]">{achievement.label}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-center text-[11px] leading-6 text-[var(--cabi-text-faint)]">
        Conversation content is not shown here. Eligibility decisions are answerable from counts and the XP ledger.
      </p>
    </div>
  );
}