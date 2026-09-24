"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trophy } from "lucide-react";

import { SeasonCountdown } from "@/components/ranking/season-countdown";
import { tierByNumber } from "@/lib/ranking/tiers";

type Season = { id: string; label: string; startsAt: string; endsAt: string; status: string } | null;
type Summary = { participants: number; totalXp: number; topUsername: string | null; topXp: number | null } | null;
type TopEntry = { placement: number; username: string; xp: number; tier: { tier: number } };
type Reward = { id: string; placement: number; xp: number; username: string | null; walletAddress: string | null; status: string; note: string | null; seasonType: string | null; seasonLabel: string | null };
type Flagged = { wallet_account_id: string; username: string | null; ranking_status: string };
type Tuning = {
  thresholds: Record<string, number>;
  daily_xp_cap: number;
  image_xp_per_day: number;
  max_weekly_placement: number;
} | null;

type Payload = {
  tuning: Tuning;
  weekly: { season: Season; summary: Summary; top: TopEntry[] };
  monthly: { season: Season; summary: Summary; top: TopEntry[] };
  rewards: Reward[];
  flagged: Flagged[];
};

/**
 * Ranking administration.
 *
 * A reset closes the active period and opens the next one. It never deletes
 * history: the closed season keeps its stats, frozen placements and reward
 * snapshots. Both destructive actions require an explicit confirmation step.
 */
export function AdminRankingPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<"WEEKLY" | "MONTHLY" | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState({ walletAccountId: "", delta: "", reason: "" });
  // Local mirror of the tuning form, seeded from the server on load.
  const [tuningForm, setTuning] = useState<{ EXPLORER: string; COMPANION: string; ELITE: string; MASTER: string; LEGEND: string; dailyXpCap: string; imageXpPerDay: string; rewardPlacements: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ranking", { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      const payload = await response.json() as Payload;
      setData(payload);
      // Seed the form once, so an in-progress edit is not clobbered by a refresh.
      if (payload.tuning) {
        setTuning((current) => current ?? {
          EXPLORER: String(payload.tuning!.thresholds.EXPLORER ?? 500),
          COMPANION: String(payload.tuning!.thresholds.COMPANION ?? 1500),
          ELITE: String(payload.tuning!.thresholds.ELITE ?? 4000),
          MASTER: String(payload.tuning!.thresholds.MASTER ?? 9000),
          LEGEND: String(payload.tuning!.thresholds.LEGEND ?? 18000),
          dailyXpCap: String(payload.tuning!.daily_xp_cap ?? 500),
          imageXpPerDay: String(payload.tuning!.image_xp_per_day ?? 1),
          rewardPlacements: String(payload.tuning!.max_weekly_placement ?? 100),
        });
      }
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/ranking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setNotice(payload.error ?? "That action failed."); return; }
      setNotice(success);
      await load();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  if (phase === "loading") return <p className="mt-8 text-sm text-[var(--cabi-text-secondary)]" role="status">Loading ranking...</p>;
  if (phase === "error" || !data) return <p className="mt-8 text-sm text-rose-300">Could not load the ranking console.</p>;

  const seasonCard = (title: string, type: "WEEKLY" | "MONTHLY", season: Season, summary: Summary, top: TopEntry[]) => (
    <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Trophy size={15} className="text-[var(--cabi-primary)]" aria-hidden="true" /> {title}</h2>
        {season ? <SeasonCountdown endsAt={season.endsAt} onElapsed={() => void load()} /> : <span className="text-xs text-[var(--cabi-text-muted)]">none active</span>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[var(--cabi-text-faint)]">Start</dt><dd className="mt-1 text-[var(--cabi-text-secondary)]">{season ? new Date(season.startsAt).toLocaleString() : "-"}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[var(--cabi-text-faint)]">End</dt><dd className="mt-1 text-[var(--cabi-text-secondary)]">{season ? new Date(season.endsAt).toLocaleString() : "-"}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[var(--cabi-text-faint)]">Participants</dt><dd className="mt-1 font-mono text-[var(--cabi-text-secondary)]">{summary?.participants ?? 0}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[var(--cabi-text-faint)]">Total XP</dt><dd className="mt-1 font-mono text-[var(--cabi-text-secondary)]">{(summary?.totalXp ?? 0).toLocaleString()}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] text-[var(--cabi-text-muted)]">{season?.label ?? "No period has been started."}</p>

      {top.length > 0 ? (
        <ol className="mt-4 divide-y divide-white/[0.05] rounded-2xl border border-[var(--cabi-hairline)]">
          {top.map((entry) => (
            <li key={entry.username} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-8 font-mono text-[11px] text-[var(--cabi-text-muted)]">#{entry.placement}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-white">{entry.username}</span>
              <span className="text-[10px] uppercase tracking-[.12em] text-[var(--cabi-primary)]">{tierByNumber(entry.tier.tier).key}</span>
              <span className="w-20 text-right font-mono text-[12px] text-[var(--cabi-primary)]">{entry.xp.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 text-[11px] text-[var(--cabi-text-faint)]">Nobody has earned XP in this period yet.</p>}

      <div className="mt-4">
        {confirming === type ? (
          <div className="rounded-2xl border border-amber-200/[0.22] bg-amber-200/[0.05] p-4">
            <p className="text-[13px] font-semibold text-amber-50">Reset {type === "WEEKLY" ? "the weekly leaderboard" : "the monthly season"}?</p>
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-secondary)]">
              This closes the current period and opens a new one. The closed period keeps its stats, final placements, and reward snapshots - nothing is deleted.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="focus-ring h-9 rounded-xl border border-[var(--cabi-border)] px-3.5 text-[11px] font-semibold text-[var(--cabi-text-secondary)]">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void act({ action: "reset", type }, "Period closed and a new one started.")} className="focus-ring h-9 rounded-xl bg-amber-200 px-3.5 text-[11px] font-bold text-[var(--cabi-on-primary)] disabled:opacity-40">Reset</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(type)} className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--cabi-border)] px-3.5 text-[11px] font-semibold text-[var(--cabi-text-secondary)] hover:bg-[var(--cabi-surface-2)]">
            <RotateCcw size={12} aria-hidden="true" /> Reset &amp; start new period
          </button>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      {notice ? <p role="status" className="rounded-xl border border-violet-200/[0.16] bg-violet-300/[0.06] px-3 py-2 text-xs text-[var(--cabi-text-secondary)]">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {seasonCard("Current weekly period", "WEEKLY", data.weekly.season, data.weekly.summary, data.weekly.top)}
        {seasonCard("Current monthly season", "MONTHLY", data.monthly.season, data.monthly.summary, data.monthly.top)}
      </div>

      {/* Rank tuning. Thresholds are frozen per season, and that is stated plainly. */}
      {tuningForm ? (
        <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
          <h2 className="text-sm font-bold text-white">Rank thresholds and caps</h2>
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
            Each tier must cost more than the one before it. A season freezes the thresholds in force when it was created, so changes here apply from the <span className="text-[var(--cabi-primary)]">next</span> season rather than rewriting the board currently being raced.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {([["EXPLORER", "Explorer"], ["COMPANION", "Companion"], ["ELITE", "Elite"], ["MASTER", "Master"], ["LEGEND", "Legend"], ["dailyXpCap", "Daily XP cap"], ["imageXpPerDay", "Image XP per day"], ["rewardPlacements", "Reward placements"]] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--cabi-text-muted)]">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={tuningForm[key]}
                  onChange={(event) => setTuning({ ...tuningForm, [key]: event.target.value })}
                  aria-label={label}
                  className="focus-ring mt-2 h-9 w-full rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 font-mono text-[12px] text-white"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || Object.values(tuningForm).some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)}
            onClick={() => void act({
              action: "tuning",
              thresholds: {
                EXPLORER: Number(tuningForm.EXPLORER),
                COMPANION: Number(tuningForm.COMPANION),
                ELITE: Number(tuningForm.ELITE),
                MASTER: Number(tuningForm.MASTER),
                LEGEND: Number(tuningForm.LEGEND),
              },
              dailyXpCap: Number(tuningForm.dailyXpCap),
              imageXpPerDay: Number(tuningForm.imageXpPerDay),
              rewardPlacements: Number(tuningForm.rewardPlacements),
            }, "Tuning saved. It applies from the next season.")}
            className="focus-ring mt-3 h-9 rounded-xl bg-violet-300 px-4 text-[11px] font-bold text-[var(--cabi-on-primary)] disabled:opacity-40"
          >
            Save tuning
          </button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">Manual XP adjustment</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          Every adjustment writes an immutable XP event and an audit record. Use it for event rewards and corrections only.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input value={adjust.walletAccountId} onChange={(event) => setAdjust({ ...adjust, walletAccountId: event.target.value })} placeholder="wallet account id" aria-label="Wallet account id" className="focus-ring h-9 rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 font-mono text-[11px] text-white" />
          <input value={adjust.delta} onChange={(event) => setAdjust({ ...adjust, delta: event.target.value })} placeholder="+500 or -500" aria-label="XP amount" inputMode="numeric" className="focus-ring h-9 rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 font-mono text-[11px] text-white" />
          <input value={adjust.reason} onChange={(event) => setAdjust({ ...adjust, reason: event.target.value })} placeholder="Reason (required)" aria-label="Reason" className="focus-ring h-9 rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 text-[11px] text-white" />
        </div>
        <button
          type="button"
          disabled={busy || !adjust.walletAccountId || !adjust.reason || !Number.isFinite(Number(adjust.delta)) || Number(adjust.delta) === 0}
          onClick={() => void act({ action: "adjust", walletAccountId: adjust.walletAccountId, delta: Number(adjust.delta), reason: adjust.reason }, "XP adjusted and recorded.")}
          className="focus-ring mt-3 h-9 rounded-xl bg-violet-300 px-4 text-[11px] font-bold text-[var(--cabi-on-primary)] disabled:opacity-40"
        >
          Apply adjustment
        </button>
      </section>

      <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">Reward workflow</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          Winners are snapshotted automatically when a period is finalized. The site never transfers value: mark each one rewarded once you have paid it out yourself.
        </p>
        {data.rewards.length === 0 ? (
          <p className="mt-4 text-[11px] text-[var(--cabi-text-faint)]">No snapshots yet. They appear when a period closes.</p>
        ) : (
          <ol className="mt-4 divide-y divide-white/[0.05] rounded-2xl border border-[var(--cabi-hairline)]">
            {data.rewards.map((reward) => (
              <li key={reward.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <span className="w-8 font-mono text-[11px] text-[var(--cabi-text-muted)]">#{reward.placement}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-white">{reward.username ?? "unknown"}</span>
                  <span className="block truncate font-mono text-[10px] text-[var(--cabi-text-faint)]">{reward.walletAddress ?? "-"} - {reward.seasonLabel ?? ""}</span>
                </span>
                <span className="font-mono text-[12px] text-[var(--cabi-primary)]">{reward.xp.toLocaleString()}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.1em] ${reward.status === "REWARDED" ? "bg-emerald-300/[0.12] text-emerald-200" : reward.status === "SKIPPED" ? "bg-[var(--cabi-surface-3)] text-[var(--cabi-text-muted)]" : "bg-amber-200/[0.12] text-amber-100"}`}>{reward.status}</span>
                <span className="flex gap-1.5">
                  <button type="button" disabled={busy} onClick={() => void act({ action: "reward", id: Number(reward.id), status: "REWARDED" }, "Marked rewarded.")} className="focus-ring h-8 rounded-lg border border-emerald-300/[0.24] px-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">Rewarded</button>
                  <button type="button" disabled={busy} onClick={() => void act({ action: "reward", id: Number(reward.id), status: "SKIPPED" }, "Marked skipped.")} className="focus-ring h-8 rounded-lg border border-[var(--cabi-border)] px-2.5 text-[10px] font-semibold text-[var(--cabi-text-muted)] disabled:opacity-40">Skip</button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.flagged.length > 0 ? (
        <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
          <h2 className="text-sm font-bold text-white">Flagged accounts</h2>
          <ul className="mt-3 space-y-2">
            {data.flagged.map((row) => (
              <li key={row.wallet_account_id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--cabi-text-secondary)]">{row.username ?? row.wallet_account_id}</span>
                <span className="text-[10px] uppercase tracking-[.12em] text-amber-100">{row.ranking_status}</span>
                <button type="button" disabled={busy} onClick={() => void act({ action: "eligibility", walletAccountId: row.wallet_account_id, status: "NORMAL" }, "Restored to the leaderboard.")} className="focus-ring h-8 rounded-lg border border-[var(--cabi-border)] px-2.5 text-[10px] font-semibold text-[var(--cabi-text-secondary)] disabled:opacity-40">Restore</button>
                <button type="button" disabled={busy} onClick={() => void act({ action: "eligibility", walletAccountId: row.wallet_account_id, status: "INELIGIBLE" }, "Marked ineligible.")} className="focus-ring h-8 rounded-lg border border-[var(--cabi-border)] px-2.5 text-[10px] font-semibold text-[var(--cabi-text-muted)] disabled:opacity-40">Mark ineligible</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[var(--cabi-text-faint)]">A flagged account keeps full chat access. It only drops off the reward leaderboard.</p>
        </section>
      ) : null}
    </div>
  );
}