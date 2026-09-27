"use client";

import { useEffect, useState } from "react";
import { Award, Bell, Gift, Image, MessageCircle, Sparkles } from "lucide-react";

type ActivityItem = { id: string; type: string; title: string; detail: string; createdAt: string };
const icons = { XP: Sparkles, ACHIEVEMENT: Award, REWARD: Gift, IMAGE: Image, MEMORY: MessageCircle } as const;

export function ActivityExperience({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/activity", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { items?: ActivityItem[] };
          if (!response.ok || !payload.items) throw new Error();
          setItems(payload.items);
          setPhase("ready");
        })
        .catch(() => setPhase("error"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);

  if (!authenticated) return <div className="glass mt-8 rounded-[24px] p-7 text-center"><Bell className="mx-auto text-violet-200" size={23} /><h2 className="mt-4 text-base font-semibold">Connect your wallet to see activity</h2><p className="mt-2 text-sm text-[#a8a3b3]">Your Cabi activity is private to your account.</p></div>;
  if (phase === "loading") return <p className="mt-8 text-center text-sm text-[#a8a3b3]" role="status">Loading activity…</p>;
  if (phase === "error") return <p className="mt-8 text-center text-sm text-rose-200" role="status">I couldn&apos;t load activity just now.</p>;
  if (items.length === 0) return <div className="glass mt-8 rounded-[24px] p-8 text-center"><Bell className="mx-auto text-violet-200" size={23} /><h2 className="mt-4 text-base font-semibold">Nothing new yet</h2><p className="mt-2 text-sm text-[#8e889b]">Rank, memories, images and rewards will show up here.</p></div>;

  return <ol className="glass mt-7 divide-y divide-white/[0.05] overflow-hidden rounded-[24px]">{items.map((item) => { const Icon = icons[item.type as keyof typeof icons] ?? Bell; return <li key={item.id} className="flex gap-3 p-4 sm:p-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-violet-300/[0.08] text-violet-200"><Icon size={17} aria-hidden="true" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-white">{item.title}</h2><p className="mt-1 text-xs leading-5 text-[#a8a3b3]">{item.detail}</p></div><time className="shrink-0 text-[10px] text-[#777180]" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time></li>; })}</ol>;
}
