"use client";

import { useEffect, useState } from "react";
import { Clock3, Gift, Check } from "lucide-react";

type Reward = {
  id: string;
  placement: number;
  xp: number;
  status: "PENDING" | "REWARDED" | "SKIPPED" | string;
  amount: string | null;
  transactionHash: string | null;
  note: string | null;
  rewardedAt: string | null;
  periodType: string;
  periodLabel: string;
};

export function RewardsExperience({ authenticated }: { authenticated: boolean }) {
  const [items, setItems] = useState<Reward[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/rewards", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { rewards?: Reward[] };
          if (!response.ok || !payload.rewards) throw new Error("unavailable");
          setItems(payload.rewards);
          setPhase("ready");
        })
        .catch(() => setPhase("error"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated]);

  if (!authenticated) return (
    <section className="glass mt-8 rounded-[26px] p-7 text-center">
      <Gift className="mx-auto text-violet-200" size={24} />
      <h2 className="mt-4 text-lg font-semibold">Connect your wallet to see rewards</h2>
      <p className="mt-2 text-sm leading-6 text-[#a8a3b3]">Reward records are private to the wallet that earned them.</p>
    </section>
  );
  if (phase === "loading") return <p className="mt-8 text-center text-sm text-[#a8a3b3]" role="status">Loading rewards…</p>;
  if (phase === "error") return <p className="mt-8 text-center text-sm text-rose-200" role="status">I couldn&apos;t load rewards just now.</p>;

  return (
    <section className="mt-7 space-y-3" aria-label="Your leaderboard rewards">
      <p className="text-sm leading-6 text-[#a8a3b3]">Leaderboard placement may qualify for a manually distributed reward. Amounts appear only after an admin assigns one; Cabi never transfers tokens.</p>
      {items.length === 0 ? (
        <div className="glass rounded-[24px] p-8 text-center"><Gift className="mx-auto text-violet-200" size={24} /><h2 className="mt-4 text-lg font-semibold">No rewards yet</h2><p className="mt-2 text-sm text-[#8e889b]">Closed leaderboard periods will appear here if a reward snapshot is recorded for your wallet.</p></div>
      ) : items.map((reward) => {
        const distributed = reward.status === "REWARDED";
        const skipped = reward.status === "SKIPPED";
        return (
          <article key={reward.id} className="glass rounded-[22px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-[14px] ${distributed ? "bg-emerald-300/[0.09] text-emerald-200" : "bg-violet-300/[0.08] text-violet-200"}`}>{distributed ? <Check size={17} /> : <Clock3 size={17} />}</span>
                <div><h2 className="text-sm font-semibold text-white">{reward.periodType === "WEEKLY" ? "Weekly leaderboard" : "Monthly leaderboard"}</h2><p className="mt-1 text-xs text-[#8e889b]">{reward.periodLabel} · finished #{reward.placement} with {reward.xp.toLocaleString()} XP</p></div>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${distributed ? "bg-emerald-300/[0.09] text-emerald-200" : skipped ? "bg-white/[0.05] text-[#8e889b]" : "bg-amber-200/[0.09] text-amber-100"}`}>{distributed ? "Distributed" : skipped ? "Closed" : "Pending distribution"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4 text-xs">
              <span className="text-[#8e889b]">Reward {reward.amount ? `${reward.amount} $CPU` : "Pending assignment"}</span>
              {reward.transactionHash ? <span className="max-w-full break-all font-mono text-[10px] text-[#8e889b]" title={reward.transactionHash}>Transaction {reward.transactionHash}</span> : null}
            </div>
            {reward.note ? <p className="mt-3 text-xs leading-5 text-[#a8a3b3]">{reward.note}</p> : null}
            {reward.rewardedAt ? <time className="mt-2 block text-[10px] text-[#777180]" dateTime={reward.rewardedAt}>Distributed {new Date(reward.rewardedAt).toLocaleDateString()}</time> : null}
          </article>
        );
      })}
    </section>
  );
}
