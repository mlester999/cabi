"use client";

import { useEffect, useState } from "react";
import { Award, Bell, Gift, Image, MessageCircle, Sparkles } from "lucide-react";

type ActivityItem = { id: string; type: string; title: string; detail: string; createdAt: string; isRead: boolean };
const icons = { XP: Sparkles, ACHIEVEMENT: Award, REWARD: Gift, IMAGE: Image, MEMORY: MessageCircle } as const;

export function ActivityExperience({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/activity", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { items?: ActivityItem[]; unreadCount?: number };
          if (!response.ok || !payload.items) throw new Error();
          setItems(payload.items);
          setUnreadCount(payload.unreadCount ?? 0);
          setPhase("ready");
        })
        .catch(() => setPhase("error"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);

  const markAllRead = async () => {
    setMarkingRead(true);
    setNotice(null);
    try {
      const response = await fetch("/api/activity", { method: "POST" });
      if (!response.ok) throw new Error();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      setNotice("I couldn't update your activity status. Try again.");
    } finally {
      setMarkingRead(false);
    }
  };

  if (!authenticated) return <div className="glass mt-8 rounded-[24px] p-7 text-center"><Bell className="mx-auto text-violet-200" size={23} /><h2 className="mt-4 text-base font-semibold">Connect your wallet to see activity</h2><p className="mt-2 text-sm text-[#a8a3b3]">Your Cabi activity is private to your account.</p></div>;
  if (phase === "loading") return <p className="mt-8 text-center text-sm text-[#a8a3b3]" role="status">Loading activity…</p>;
  if (phase === "error") return <p className="mt-8 text-center text-sm text-rose-200" role="status">I couldn&apos;t load activity just now.</p>;
  if (items.length === 0) return <div className="glass mt-8 rounded-[24px] p-8 text-center"><Bell className="mx-auto text-violet-200" size={23} /><h2 className="mt-4 text-base font-semibold">Nothing new yet</h2><p className="mt-2 text-sm text-[#8e889b]">Rank, memories, images and rewards will show up here.</p></div>;

  return <>
    <div className="mt-8 flex items-center justify-between gap-3">
      <p className="text-xs text-[#8e889b]">{unreadCount ? `${unreadCount} unread` : "All caught up"}</p>
      {unreadCount ? <button type="button" onClick={() => void markAllRead()} disabled={markingRead} className="focus-ring h-9 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 text-[11px] font-semibold text-violet-100 hover:bg-white/[0.05] disabled:opacity-40">{markingRead ? "Saving…" : "Mark all as read"}</button> : null}
    </div>
    {notice ? <p role="status" className="mt-3 rounded-xl bg-amber-200/[0.08] px-4 py-3 text-xs text-amber-100">{notice}</p> : null}
    <ol className="glass mt-3 divide-y divide-white/[0.05] overflow-hidden rounded-[24px]">{items.map((item) => { const Icon = icons[item.type as keyof typeof icons] ?? Bell; return <li key={item.id} className={`flex gap-3 p-4 sm:p-5 ${item.isRead ? "" : "bg-violet-300/[0.025]"}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-violet-300/[0.08] text-violet-200"><Icon size={17} aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-white">{item.title}</h2>{!item.isRead ? <span className="h-1.5 w-1.5 rounded-full bg-violet-200" aria-label="Unread" /> : null}</div><p className="mt-1 text-xs leading-5 text-[#a8a3b3]">{item.detail}</p></div><time className="shrink-0 text-[10px] text-[#777180]" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time></li>; })}</ol>
  </>;
}
