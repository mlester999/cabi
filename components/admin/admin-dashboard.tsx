"use client";

import { Activity, Bot, CircleAlert, Clock3, DatabaseZap, Image, MessageSquareText, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Stats = {
  conversations: number;
  messagesToday: number;
  activeUsers: number;
  newUsers: number;
  aiRequests: number;
  aiFailures: number;
  averageLatency: number | null;
  activitySeries: number[];
  contestEntries: number;
  knowledgeStatus: string;
  lastSync: string | null;
  pagesIndexed?: number;
  chunksIndexed?: number;
};

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      const payload = await response.json() as { stats?: Stats };
      if (!response.ok || !payload.stats) throw new Error();
      setStats(payload.stats);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (phase === "loading") return <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">Command center</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Cabi at a glance</h1><p role="status" className="mt-7 text-sm text-[#a8a3b3]">Loading live dashboard data…</p></div>;
  if (phase === "error" || !stats) return <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">Command center</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Cabi at a glance</h1><div className="mt-7 rounded-[22px] border border-amber-200/[0.12] bg-amber-200/[0.035] p-5"><p className="text-sm text-amber-100">Live dashboard data is unavailable. No placeholder metrics are shown.</p><button type="button" onClick={() => void load()} className="focus-ring mt-4 h-9 rounded-xl border border-white/[0.1] px-3 text-xs font-semibold text-white">Try again</button></div></div>;

  const cards = [
    ["Total conversations", stats.conversations, MessageSquareText],
    ["Messages today", stats.messagesToday, Activity],
    ["Active users", stats.activeUsers, UsersRound],
    ["New users today", stats.newUsers, UsersRound],
    ["AI requests today", stats.aiRequests, Bot],
    ["AI failures today", stats.aiFailures, CircleAlert],
    ["Average response", stats.averageLatency == null ? "—" : `${stats.averageLatency} ms`, Clock3],
    ["Contest entries", stats.contestEntries, Image],
    ["Knowledge status", stats.knowledgeStatus, DatabaseZap],
  ] as const;
  const peak = Math.max(0, ...stats.activitySeries);

  return <div>
    <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">Command center</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Cabi at a glance</h1>
    <p className="mt-2 text-sm text-[#8e889b]">Conversation health, AI activity, contest entries, and knowledge status.</p>
    <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, Icon]) => <div key={label} className="rounded-[22px] border border-white/[0.065] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><p className="text-xs text-[#777180]">{label}</p><Icon size={16} className="text-violet-300" aria-hidden="true" /></div><p className="mt-4 truncate text-2xl font-semibold tracking-[-.03em]">{typeof value === "number" ? value.toLocaleString() : value}</p></div>)}
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
      <section className="rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5" aria-labelledby="request-activity-heading">
        <div className="flex items-start justify-between gap-3"><div><h2 id="request-activity-heading" className="text-sm font-semibold">AI request activity</h2><p className="mt-1 text-[11px] text-[#777180]">Requests by hour over the last 12 hours</p></div><span className="font-mono text-xs text-violet-200">{stats.activitySeries.reduce((sum, value) => sum + value, 0).toLocaleString()} total</span></div>
        {peak === 0 ? <p className="mt-6 rounded-xl border border-dashed border-white/[0.07] p-5 text-center text-xs text-[#8e889b]">No AI requests were recorded in this period.</p> : <div className="mt-6 flex h-32 items-end gap-2" aria-label="Hourly AI request counts">{stats.activitySeries.map((count, index) => <div key={index} title={`${count} requests`} aria-label={`${count} requests`} className="flex h-full flex-1 items-end rounded-t-md bg-violet-300/10"><span className="block w-full rounded-t-md bg-gradient-to-t from-violet-500/30 to-violet-300/80" style={{ height: `${count === 0 ? 0 : Math.max(4, (count / peak) * 100)}%` }} /></div>)}</div>}
        {peak > 0 ? <div className="mt-2 flex justify-between text-[10px] text-[#5e5967]"><span>12 hours ago</span><span>Now</span></div> : null}
      </section>
      <section className="rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5" aria-labelledby="knowledge-heading">
        <h2 id="knowledge-heading" className="text-sm font-semibold">Knowledge base</h2>
        <p className="mt-5 text-3xl font-semibold text-violet-200">{(stats.chunksIndexed ?? 0).toLocaleString()}</p>
        <p className="mt-1 text-xs text-[#777180]">indexed chunks across {(stats.pagesIndexed ?? 0).toLocaleString()} pages</p>
        <p className="mt-6 text-xs text-[#706a7d]">{stats.lastSync ? `Last synced ${new Date(stats.lastSync).toLocaleString()}` : "No sync record"}</p>
      </section>
    </div>
  </div>;
}
