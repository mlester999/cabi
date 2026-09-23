"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { lockedFeatureCopy, type FeatureFlags } from "@/lib/config/feature-flags";

/**
 * A future feature, shown as intentionally unreleased.
 *
 * Two rules, both about honesty:
 *
 * 1. It never displays data. There is no placeholder rank, no zeroed balance, no
 *    sample leaderboard, because a plausible-looking fake is worse than nothing.
 * 2. It never routes anywhere. Activating it opens a short "in the works" note,
 *    so a normal user cannot wander into an unfinished interface.
 *
 * The treatment is a dark overlay, reduced opacity and a lock icon, so it reads
 * as deliberately closed rather than broken.
 */
export function LockedFeatureCard({ flagKey, onNotice }: {
  flagKey: keyof FeatureFlags;
  /** Reports the "in the works" message so the parent can surface it in one place. */
  onNotice?: (message: string) => void;
}) {
  const copy = lockedFeatureCopy[flagKey];
  if (!copy) return null;

  return (
    <button
      type="button"
      onClick={() => onNotice?.("Still in the works. Cabi is working on this one.")}
      aria-label={`${copy.title}. In the works.`}
      className="focus-ring group relative w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-left transition hover:border-violet-200/[0.16]"
    >
      {/* Dark overlay plus a slight blur keeps it readable but clearly closed. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#07070d]/55 backdrop-blur-[1.5px]" />
      <span className="relative flex items-start gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#8e889b]">
          <Lock size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[#c9c4d4]">{copy.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-[#777180]">{copy.description}</span>
          <span className="mt-1.5 inline-block text-[10px] font-semibold uppercase tracking-[.14em] text-violet-300/70">In the works</span>
        </span>
      </span>
    </button>
  );
}

/**
 * The section wrapper. Renders nothing when every listed feature is live, so it
 * removes itself as features ship.
 */
export function LockedFeatures({ flags, keys, title = "More with Cabi", onNotice }: {
  flags: FeatureFlags;
  keys: ReadonlyArray<keyof FeatureFlags>;
  title?: string;
  onNotice?: (message: string) => void;
}) {
  const locked = keys.filter((key) => !flags[key] && lockedFeatureCopy[key]);
  if (locked.length === 0) return null;

  return (
    <section aria-label={title}>
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#625d6d]">{title}</p>
      <div className="mt-2 space-y-2">
        {locked.map((key) => <LockedFeatureCard key={key} flagKey={key} onNotice={onNotice} />)}
      </div>
    </section>
  );
}

/** The one-line acknowledgement shown after tapping a locked card. */
export function useLockedNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const show = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2_600);
  };
  return { notice, show, clear: () => setNotice(null) };
}