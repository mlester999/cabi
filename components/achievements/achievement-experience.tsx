"use client";

import { useEffect, useState } from "react";
import { Award, Check, Clock3 } from "lucide-react";

import type { AchievementCategory } from "@/lib/ranking/achievements";

type Achievement = {
  code: string;
  label: string;
  description: string;
  category: AchievementCategory;
  earned: boolean;
  awardedAt: string | null;
};

const categories: AchievementCategory[] = ["Chat", "Memory", "Images", "Progression", "Leaderboard"];

export function AchievementExperience({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<Achievement[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/achievements", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { achievements?: Achievement[] };
          if (!response.ok || !payload.achievements) throw new Error("unavailable");
          setItems(payload.achievements);
          setPhase("ready");
        })
        .catch(() => setPhase("error"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);

  if (!authenticated) return (
    <section className="glass mt-8 rounded-[26px] p-7 text-center">
      <Award className="mx-auto text-violet-200" size={24} />
      <h2 className="mt-4 text-lg font-semibold">Connect your wallet to see achievements</h2>
      <p className="mt-2 text-sm leading-6 text-[#a8a3b3]">Your milestones are private to your Cabi account.</p>
    </section>
  );
  if (phase === "loading") return <p className="mt-8 text-center text-sm text-[#a8a3b3]" role="status">Loading achievements…</p>;
  if (phase === "error") return <p className="mt-8 text-center text-sm text-rose-200" role="status">I couldn&apos;t load your achievements just now.</p>;

  const earnedCount = items.filter((item) => item.earned).length;
  return (
    <section className="mt-7 space-y-7" aria-label="Achievement categories">
      <div className="glass flex items-center justify-between gap-3 rounded-[22px] px-5 py-4">
        <div><p className="text-sm font-semibold text-white">Your milestones</p><p className="mt-1 text-xs text-[#8e889b]">Earned through real activity. Progress never resets.</p></div>
        <p className="font-mono text-sm text-violet-200">{earnedCount} / {items.length}</p>
      </div>
      {categories.map((category) => {
        const group = items.filter((item) => item.category === category);
        if (!group.length) return null;
        return (
          <section key={category} aria-labelledby={`achievement-${category.toLowerCase()}`}>
            <h2 id={`achievement-${category.toLowerCase()}`} className="mb-3 text-sm font-semibold text-[#d5d0de]">{category}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map((item) => (
                <li key={item.code} className={`rounded-[20px] p-4 ${item.earned ? "bg-violet-300/[0.08]" : "bg-white/[0.025] opacity-75"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] ${item.earned ? "bg-violet-200/[0.12] text-violet-100" : "bg-white/[0.045] text-[#777180]"}`}>
                      {item.earned ? <Check size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">{item.label}</h3><span className={`text-[10px] font-medium ${item.earned ? "text-emerald-200" : "text-[#777180]"}`}>{item.earned ? "Earned" : "In progress"}</span></div>
                      <p className="mt-1 text-xs leading-5 text-[#a8a3b3]">{item.description}</p>
                      {item.awardedAt ? <time className="mt-2 block text-[10px] text-[#777180]" dateTime={item.awardedAt}>{new Date(item.awardedAt).toLocaleDateString()}</time> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
