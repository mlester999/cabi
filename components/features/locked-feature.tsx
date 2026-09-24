"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cabiFeatureForFlag, lockedFeatureCopy, type FeatureFlags } from "@/lib/config/feature-flags";

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
export function LockedFeatureCard({ flagKey, icon, onNotice }: {
  flagKey: keyof FeatureFlags;
  icon?: React.ReactNode;
  /** Reports the "in the works" message so the parent can surface it in one place. */
  onNotice?: (message: string) => void;
}) {
  const definition = cabiFeatureForFlag(flagKey);
  const copy = lockedFeatureCopy[flagKey] ?? (definition ? { title: definition.label, description: definition.description } : undefined);
  const [open, setOpen] = useState(false);
  if (!copy) return null;

  const handleClick = () => {
    onNotice?.("Still in the works. Cabi is working on this one.");
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${copy.title}. In the works.`}
        className="cabi-locked focus-ring group relative w-full overflow-hidden p-5 text-left transition"
      >
        {/* The decoration is intentionally soft and desaturated: this is a
            roadmap card, not a disabled-looking product preview. */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-violet-300/[0.08] blur-3xl grayscale" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#07070d]/45 backdrop-blur-[1.5px]" />
        <span className="relative flex items-start gap-4">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/[0.09] bg-white/[0.035] text-[#a8a3b3] transition group-hover:border-violet-200/[0.22] group-hover:text-violet-200">
            {icon ?? <Lock size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-3">
              <span className="block truncate text-[15px] font-semibold text-[#d5d0de]">{copy.title}</span>
              <Lock size={14} className="mt-0.5 shrink-0 text-[#777180]" aria-hidden="true" />
            </span>
            <span className="mt-1.5 block text-[12px] leading-5 text-[#8e889b]">{copy.description}</span>
            <span className="mt-3 inline-flex items-center rounded-full border border-violet-200/[0.13] bg-violet-300/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.14em] text-violet-200/80">In the works</span>
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="cabi-modal border-violet-200/[0.14] bg-[#100d19] text-white sm:max-w-md">
          <DialogHeader className="pr-7 text-left">
            <DialogTitle className="flex items-center gap-2 text-white"><Lock size={16} className="text-violet-200" aria-hidden="true" /> {copy.title} is still in the works</DialogTitle>
            <DialogDescription className="mt-1 leading-6 text-[#a8a3b3]">
              {copy.description} Cabi is shaping this one now. There&apos;s no unfinished page to open yet.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs leading-5 text-[#777180]">
            I&apos;ll keep the chat focused while this feature is being built.
          </p>
        </DialogContent>
      </Dialog>
    </>
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
