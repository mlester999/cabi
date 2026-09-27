"use client";

import Link from "next/link";
import { Award, Bell, Gift, Image as ImageIcon, MessageCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ActivityItem = { id: string; type: string; title: string; detail: string; createdAt: string; isRead: boolean };
type ActivityPayload = { items?: ActivityItem[]; unreadCount?: number; error?: string };
const icons = { XP: Sparkles, ACHIEVEMENT: Award, REWARD: Gift, IMAGE: ImageIcon, MEMORY: MessageCircle } as const;

/** Small authenticated notification center backed by the durable activity feed. */
export function ActivityNotificationMenu({ authenticated }: { authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/activity", { cache: "no-store" });
      const payload = await response.json() as ActivityPayload;
      if (!response.ok || !payload.items) throw new Error(payload.error ?? "Activity is unavailable right now.");
      setItems(payload.items.slice(0, 5));
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      setError("Activity is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const poll = window.setInterval(() => { void load(); }, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); };
  }, [load]);

  const markAllRead = async () => {
    if (!authenticated || unreadCount === 0) return;
    setMarkingRead(true);
    setError(null);
    try {
      const response = await fetch("/api/activity", { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Activity is unavailable right now.");
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      setError("I couldn't mark activity as read. Try again.");
    } finally {
      setMarkingRead(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => { const next = !open; setOpen(next); if (next) void load(); }} className="focus-ring relative grid h-10 w-10 place-items-center rounded-xl text-white/55 transition hover:bg-white/[0.04] hover:text-white" aria-label={unreadCount ? `Activity, ${unreadCount} unread` : "Activity"} aria-expanded={open} aria-controls="activity-notification-menu">
        <Bell size={17} aria-hidden="true" />
        {unreadCount > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full border border-[var(--cabi-bg)] bg-rose-300" aria-label="Unread activity" /> : null}
      </button>
      {open ? (
        <section id="activity-notification-menu" className="absolute right-0 top-12 z-[80] w-[min(22rem,calc(100vw-1.5rem))] rounded-[22px] border border-white/[0.09] bg-[#100d19] p-3 shadow-[0_24px_80px_rgba(0,0,0,.55)]" aria-label="Recent activity">
          <div className="flex items-center justify-between gap-3 px-2 py-1">
            <div><p className="text-sm font-semibold text-white">Activity</p><p className="mt-0.5 text-[10px] text-[#777180]">{unreadCount ? `${unreadCount} unread` : "All caught up"}</p></div>
            {unreadCount > 0 ? <button type="button" onClick={() => void markAllRead()} disabled={markingRead} className="focus-ring rounded-lg px-2 py-1.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-300/[0.08] disabled:opacity-50">{markingRead ? "Saving…" : "Mark all read"}</button> : null}
          </div>
          {!authenticated ? <p className="px-2 py-5 text-center text-xs leading-5 text-[#a8a3b3]">Connect your wallet to see your activity.</p> : null}
          {authenticated && loading && items.length === 0 && !error ? <p role="status" className="px-2 py-5 text-center text-xs text-[#a8a3b3]">Loading activity…</p> : null}
          {authenticated && error ? <div className="px-2 py-4 text-center"><p role="status" className="text-xs text-rose-200">{error}</p><button type="button" onClick={() => void load()} className="focus-ring mt-2 rounded-lg px-2 py-1 text-[10px] font-semibold text-violet-200">Try again</button></div> : null}
          {authenticated && !loading && !error && items.length === 0 ? <p className="px-2 py-5 text-center text-xs text-[#a8a3b3]">Nothing new yet.</p> : null}
          {authenticated && items.length > 0 ? <ol className="mt-2 divide-y divide-white/[0.05]">{items.map((item) => { const Icon = icons[item.type as keyof typeof icons] ?? Bell; return <li key={item.id} className={`flex gap-2.5 rounded-xl px-2 py-3 ${item.isRead ? "" : "bg-violet-300/[0.035]"}`}><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-300/[0.08] text-violet-200"><Icon size={14} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-[11px] font-semibold text-white">{item.title}</span>{!item.isRead ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-200" aria-label="Unread" /> : null}</span><span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-[#8e889b]">{item.detail}</span><time className="mt-1 block text-[9px] text-[#625d6d]" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time></span></li>; })}</ol> : null}
          <Link href="/activity" onClick={() => setOpen(false)} className="focus-ring mt-2 flex h-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.05]">View all activity</Link>
        </section>
      ) : null}
    </div>
  );
}
