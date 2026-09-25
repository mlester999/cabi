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
type Suspicious = { wallet_account_id: string; username: string | null; message_events: number; duplicate_events: number; cap_hits: number; rapid_events: number; last_event_at: string };
type RecentEvent = { id: number; walletAccountId: string; username: string | null; delta: number; eventType: string; reasonCode: string; qualityScore: number | null; createdAt: string };
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
  suspicious: Suspicious[];
  recentEvents: RecentEvent[];
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
  const [tuningForm, setTuning] = useState<{ FAMILIAR: string; COMPANION: string; ELITE: string; MASTER: string; LEGEND: string; dailyXpCap: string; imageXpPerDay: string; rewardPlacements: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ranking", { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      const payload = await response.json() as Payload;
      setData(payload);
      // Seed the form once, so an in-progress edit is not clobbered by a refresh.
      if (payload.tuning) {
        setTuning((current) => current ?? {
          FAMILIAR: String(payload.tuning!.thresholds.FAMILIAR ?? 500),
          COMPANION: String(payload.tuning!.thresholds.COMPANION ?? 2000),
          ELITE: String(payload.tuning!.thresholds.ELITE ?? 6000),
          MASTER: String(payload.tuning!.thresholds.MASTER ?? 15000),
          LEGEND: String(payload.tuning!.thresholds.LEGEND ?? 35000),
          dailyXpCap: String(payload.tuning!.daily_xp_cap ?? 300),
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

  if (phase === "loading") return <p className="mt-8 text-sm text-[#a8a3b3]" role="status">Loading ranking...</p>;
  if (phase === "error" || !data) return <p className="mt-8 text-sm text-rose-300">Could not load the ranking console.</p>;

  const seasonCard = (title: string, type: "WEEKLY" | "MONTHLY", season: Season, summary: Summary, top: TopEntry[]) => (
    <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Trophy size={15} className="text-violet-300" aria-hidden="true" /> {title}</h2>
        {season ? <SeasonCountdown endsAt={season.endsAt} onElapsed={() => void load()} /> : <span className="text-xs text-[#777180]">none active</span>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[#625d6d]">Start</dt><dd className="mt-1 text-[#d5d0de]">{season ? new Date(season.startsAt).toLocaleString() : "-"}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[#625d6d]">End</dt><dd className="mt-1 text-[#d5d0de]">{season ? new Date(season.endsAt).toLocaleString() : "-"}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[#625d6d]">Participants</dt><dd className="mt-1 font-mono text-[#d5d0de]">{summary?.participants ?? 0}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-[.14em] text-[#625d6d]">Total XP</dt><dd className="mt-1 font-mono text-[#d5d0de]">{(summary?.totalXp ?? 0).toLocaleString()}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] text-[#777180]">{season?.label ?? "No period has been started."}</p>

      {top.length > 0 ? (
        <ol className="mt-4 divide-y divide-white/[0.05] rounded-2xl border border-white/[0.05]">
          {top.map((entry) => (
            <li key={entry.username} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-8 font-mono text-[11px] text-[#777180]">#{entry.placement}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-white">{entry.username}</span>
              <span className="text-[10px] uppercase tracking-[.12em] text-violet-200">{tierByNumber(entry.tier.tier).key}</span>
              <span className="w-20 text-right font-mono text-[12px] text-violet-200">{entry.xp.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 text-[11px] text-[#625d6d]">Nobody has earned XP in this period yet.</p>}

      <div className="mt-4">
        {confirming === type ? (
          <div className="rounded-2xl border border-amber-200/[0.22] bg-amber-200/[0.05] p-4">
            <p className="text-[13px] font-semibold text-amber-50">End this leaderboard period now?</p>
            <p className="mt-1.5 text-[11px] leading-5 text-[#d5d0de]">
              This closes the current period, snapshots its results, and starts a new period. Historical XP remains intact.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="focus-ring h-9 rounded-xl border border-white/[0.1] px-3.5 text-[11px] font-semibold text-[#d5d0de]">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void act({ action: "reset", type }, "Period finalized and a new one started.")} className="focus-ring h-9 rounded-xl bg-amber-200 px-3.5 text-[11px] font-bold text-[#241a05] disabled:opacity-40">End period</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!season || season.status !== "ACTIVE" || busy} onClick={() => void act({ action: "recalculate", periodId: season!.id }, "Active-period totals recalculated from the XP ledger.")} className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.1] px-3.5 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.04] disabled:opacity-40">Recalculate</button>
            <button type="button" onClick={() => setConfirming(type)} className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.1] px-3.5 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.04]">
              <RotateCcw size={12} aria-hidden="true" /> End current period
            </button>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      {notice ? <p role="status" className="rounded-xl border border-violet-200/[0.16] bg-violet-300/[0.06] px-3 py-2 text-xs text-violet-100">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {seasonCard("Current weekly period", "WEEKLY", data.weekly.season, data.weekly.summary, data.weekly.top)}
        {seasonCard("Current monthly season", "MONTHLY", data.monthly.season, data.monthly.summary, data.monthly.top)}
      </div>

      {/* Rank thresholds apply to lifetime XP. Board totals stay period-based. */}
      {tuningForm ? (
        <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
          <h2 className="text-sm font-bold text-white">Rank thresholds and caps</h2>
          <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
            Rank is based on lifetime XP. Changing thresholds updates rank labels without changing weekly or monthly XP totals.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {([["FAMILIAR", "Familiar"], ["COMPANION", "Companion"], ["ELITE", "Elite"], ["MASTER", "Master"], ["LEGEND", "Legend"], ["dailyXpCap", "Daily XP cap"], ["imageXpPerDay", "Image XP per day"], ["rewardPlacements", "Reward placements"]] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#777180]">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={tuningForm[key]}
                  onChange={(event) => setTuning({ ...tuningForm, [key]: event.target.value })}
                  aria-label={label}
                  className="focus-ring mt-2 h-10 w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 font-mono text-[12px] text-white"
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
                FAMILIAR: Number(tuningForm.FAMILIAR),
                COMPANION: Number(tuningForm.COMPANION),
                ELITE: Number(tuningForm.ELITE),
                MASTER: Number(tuningForm.MASTER),
                LEGEND: Number(tuningForm.LEGEND),
              },
              dailyXpCap: Number(tuningForm.dailyXpCap),
              imageXpPerDay: Number(tuningForm.imageXpPerDay),
              rewardPlacements: Number(tuningForm.rewardPlacements),
            }, "Rank thresholds and XP caps saved.")}
            className="focus-ring mt-3 h-10 rounded-xl bg-violet-300 px-4 text-[11px] font-bold text-[#160f22] disabled:opacity-40"
          >
            Save tuning
          </button>
        </section>
      ) : null}

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Manual XP adjustment</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
          Every adjustment writes an immutable XP event and an audit record. Use it for event rewards and corrections only.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input value={adjust.walletAccountId} onChange={(event) => setAdjust({ ...adjust, walletAccountId: event.target.value })} placeholder="wallet account id" aria-label="Wallet account id" className="focus-ring h-10 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 font-mono text-[11px] text-white" />
          <input value={adjust.delta} onChange={(event) => setAdjust({ ...adjust, delta: event.target.value })} placeholder="+500 or -500" aria-label="XP amount" inputMode="numeric" className="focus-ring h-10 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 font-mono text-[11px] text-white" />
          <input value={adjust.reason} onChange={(event) => setAdjust({ ...adjust, reason: event.target.value })} placeholder="Reason (required)" aria-label="Reason" className="focus-ring h-10 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 text-[11px] text-white" />
        </div>
        <button
          type="button"
          disabled={busy || !adjust.walletAccountId || !adjust.reason || !Number.isFinite(Number(adjust.delta)) || Number(adjust.delta) === 0}
          onClick={() => void act({ action: "adjust", walletAccountId: adjust.walletAccountId, delta: Number(adjust.delta), reason: adjust.reason }, "XP adjusted and recorded.")}
          className="focus-ring mt-3 h-10 rounded-xl bg-violet-300 px-4 text-[11px] font-bold text-[#160f22] disabled:opacity-40"
        >
          Apply adjustment
        </button>
      </section>

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Reward workflow</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
          Winners are snapshotted automatically when a period is finalized. The site never transfers value: mark each one rewarded once you have paid it out yourself.
        </p>
        {data.rewards.length === 0 ? (
          <p className="mt-4 text-[11px] text-[#625d6d]">No snapshots yet. They appear when a period closes.</p>
        ) : (
          <ol className="mt-4 divide-y divide-white/[0.05] rounded-2xl border border-white/[0.05]">
            {data.rewards.map((reward) => (
              <li key={reward.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <span className="w-8 font-mono text-[11px] text-[#777180]">#{reward.placement}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-white">{reward.username ?? "unknown"}</span>
                  <span className="block truncate font-mono text-[10px] text-[#625d6d]">{reward.walletAddress ?? "-"} - {reward.seasonLabel ?? ""}</span>
                </span>
                <span className="font-mono text-[12px] text-violet-200">{reward.xp.toLocaleString()}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.1em] ${reward.status === "REWARDED" ? "bg-emerald-300/[0.12] text-emerald-200" : reward.status === "SKIPPED" ? "bg-white/[0.06] text-[#8e889b]" : "bg-amber-200/[0.12] text-amber-100"}`}>{reward.status}</span>
                <span className="flex gap-1.5">
                  <button type="button" disabled={busy} onClick={() => void act({ action: "reward", id: Number(reward.id), status: "REWARDED" }, "Marked rewarded.")} className="focus-ring h-8 rounded-lg border border-emerald-300/[0.24] px-2.5 text-[10px] font-semibold text-emerald-200 disabled:opacity-40">Rewarded</button>
                  <button type="button" disabled={busy} onClick={() => void act({ action: "reward", id: Number(reward.id), status: "SKIPPED" }, "Marked skipped.")} className="focus-ring h-8 rounded-lg border border-white/[0.1] px-2.5 text-[10px] font-semibold text-[#8e889b] disabled:opacity-40">Skip</button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.flagged.length > 0 ? (
        <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
          <h2 className="text-sm font-bold text-white">Flagged accounts</h2>
          <ul className="mt-3 space-y-2">
            {data.flagged.map((row) => (
              <li key={row.wallet_account_id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[12px] text-[#d5d0de]">{row.username ?? row.wallet_account_id}</span>
                <span className="text-[10px] uppercase tracking-[.12em] text-amber-100">{row.ranking_status}</span>
                <button type="button" disabled={busy} onClick={() => void act({ action: "eligibility", walletAccountId: row.wallet_account_id, status: "NORMAL" }, "Restored to the leaderboard.")} className="focus-ring h-8 rounded-lg border border-white/[0.1] px-2.5 text-[10px] font-semibold text-[#d5d0de] disabled:opacity-40">Restore</button>
                <button type="button" disabled={busy} onClick={() => void act({ action: "eligibility", walletAccountId: row.wallet_account_id, status: "INELIGIBLE" }, "New automatic XP is blocked.")} className="focus-ring h-8 rounded-lg border border-white/[0.1] px-2.5 text-[10px] font-semibold text-[#8e889b] disabled:opacity-40">Block XP</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[#625d6d]">Review hides an account from standings while it can continue earning. Block XP stops automatic awards; chat remains available, and manual admin adjustments stay audited.</p>
        </section>
      ) : null}

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Recent XP events</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">Latest 30 ledger entries. XP events are append-only; message contents are never shown here.</p>
        {data.recentEvents.length === 0 ? <p className="mt-4 text-[11px] text-[#625d6d]">No XP events yet.</p> : (
          <ol className="mt-3 divide-y divide-white/[0.05] rounded-2xl border border-white/[0.05]">
            {data.recentEvents.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-white">{event.username ?? event.walletAccountId.slice(0, 8)}</span>
                <span className="font-mono text-[11px] text-violet-200">{event.delta > 0 ? "+" : ""}{event.delta} XP</span>
                <span className="rounded-full border border-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-[.1em] text-[#a8a3b3]">{event.qualityScore == null ? "N/A" : (["Low", "Normal", "Good", "Great"] as const)[event.qualityScore] ?? "Unknown"}</span>
                <span className="text-[10px] text-[#a8a3b3]">{event.eventType}</span>
                <span className="text-[10px] text-[#777180]">{event.reasonCode}</span>
                <time className="text-[10px] text-[#625d6d]" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Activity for review</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">Signals are prompts for a human review, not automatic accusations or penalties. Data covers the last 24 hours.</p>
        {data.suspicious.length === 0 ? <p className="mt-4 text-[11px] text-[#625d6d]">No unusual activity to review.</p> : (
          <ul className="mt-3 divide-y divide-white/[0.05] rounded-2xl border border-white/[0.05]">
            {data.suspicious.map((row) => (
              <li key={row.wallet_account_id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <span className="min-w-0 flex-1 truncate text-[12px] text-white">{row.username ?? row.wallet_account_id.slice(0, 8)}</span>
                <span className="text-[10px] text-[#a8a3b3]">{row.message_events} messages</span>
                <span className="text-[10px] text-[#a8a3b3]">{row.duplicate_events} repeats</span>
                <span className="text-[10px] text-[#a8a3b3]">{row.cap_hits} cap hits</span>
                <span className="text-[10px] text-[#a8a3b3]">{row.rapid_events} rapid</span>
                <button type="button" disabled={busy} onClick={() => void act({ action: "eligibility", walletAccountId: row.wallet_account_id, status: "REVIEW" }, "Account marked for review; no XP was removed.")} className="focus-ring h-8 rounded-lg border border-amber-200/[0.2] px-2.5 text-[10px] font-semibold text-amber-100 disabled:opacity-40">Mark for review</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
