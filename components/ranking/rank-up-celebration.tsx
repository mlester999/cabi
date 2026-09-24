"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";

import { rankUpMessage, type RankTier } from "@/lib/ranking/tiers";

/**
 * The rank-up celebration.
 *
 * Deliberately small and self-dismissing: the brief asks for a premium moment
 * that is not visually obnoxious. It is a polite toast rather than a blocking
 * modal, because a rank-up happens mid-conversation and stealing focus from the
 * composer would be worse than the celebration is good.
 *
 * Reduced-motion users get the same information with no animation.
 */
export function RankUpCelebration({ tier, achievements = [], onDismiss }: {
  tier: RankTier | null;
  achievements?: string[];
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!tier) return;
    // Long enough to read, short enough not to linger.
    const timer = window.setTimeout(onDismiss, 6_000);
    return () => window.clearTimeout(timer);
  }, [tier, onDismiss]);

  return (
    <AnimatePresence>
      {tier ? (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 bottom-28 z-[75] flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto relative overflow-hidden rounded-[24px] border border-violet-200/[0.22] bg-[#0d0b15]/96 px-5 py-4 shadow-[0_20px_60px_rgba(139,92,246,.25)] backdrop-blur-xl motion-reduce:transition-none">
            {/* Lavender glow, animated only for users who have not asked for less motion. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-8 -z-10 opacity-70 blur-3xl motion-safe:animate-pulse"
              style={{ backgroundColor: `${tier.accent}33` }}
            />
            <div className="flex items-center gap-3.5">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/[0.12]"
                style={{ backgroundColor: `${tier.accent}22` }}
                aria-hidden="true"
              >
                <Sparkles size={19} style={{ color: tier.accent }} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Rank up</p>
                <p className="mt-0.5 text-base font-bold tracking-[-0.01em] text-white">{tier.label}</p>
                <p className="mt-0.5 text-[12px] text-[#c9c4d4]">{rankUpMessage(tier)}</p>
                {achievements.length > 0 ? (
                  <p className="mt-1.5 text-[11px] text-violet-200">Also earned: {achievements.join(", ")}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="focus-ring ml-1 grid h-8 w-8 shrink-0 place-items-center self-start rounded-lg text-[#777180] hover:bg-white/[0.06] hover:text-white"
                aria-label="Dismiss rank up"
              >
                <span aria-hidden="true" className="text-lg leading-none">&times;</span>
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}