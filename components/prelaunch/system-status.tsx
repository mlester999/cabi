"use client";

import { useState } from "react";

import { CabiMascot } from "@/components/cabi/cabi-mascot";

/** A plain statement of the public site's current launch state. */
export function SystemStatus({ statusLabel, className = "" }: { statusLabel: string; className?: string }) {
  return (
    <section className={`glass rounded-[26px] p-4 sm:p-5 ${className}`} aria-label="Public launch status">
      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">{statusLabel}</p>
      <div className="mt-4 flex items-start gap-3">
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-300" />
        <div>
          <p className="text-sm font-medium text-white">Prelaunch</p>
          <p className="mt-1 text-[12px] leading-5 text-[#8e889b]">The public companion experience is not open yet.</p>
        </div>
      </div>
    </section>
  );
}

const easterEggs = [
  "I saved you the coziest spot.",
  "Psst... I can hear you from here.",
  "I picked the soft blanket. Obviously.",
  "The public doors are closed, but you can still say hi.",
  "My ears are listening.",
] as const;

/** A small, opt-in Cabi moment on the public prelaunch page. */
export function CabiMascotSpot({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(-1);
  const spoken = index < 0 ? null : easterEggs[index % easterEggs.length];

  return (
    <div className={`relative flex items-end gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => setIndex((value) => (value + 1) % easterEggs.length)}
        aria-label={spoken ? `Cabi says: ${spoken}. Activate for another line.` : "Cabi, your Cat Partner Unit. Activate to hear from her."}
        className="focus-ring group relative grid h-[74px] w-[74px] shrink-0 place-items-center rounded-[24px] border border-violet-200/[0.13] bg-[#0d0a18]/80 transition hover:border-violet-200/25 hover:bg-violet-300/[0.06] sm:h-[86px] sm:w-[86px]"
      >
        <span aria-hidden="true" className="absolute inset-0 rounded-[24px] bg-violet-400/[0.10] blur-xl" />
        <CabiMascot className="relative h-[58px] w-[58px] sm:h-[68px] sm:w-[68px]" />
      </button>

      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[11px] uppercase tracking-[.2em] text-[#625d6d]">Cat Mode</p>
        <div className="mt-1.5 min-h-[42px] rounded-2xl rounded-bl-md border border-violet-200/[0.12] bg-violet-300/[0.05] px-3.5 py-2.5" role={spoken ? "status" : undefined} aria-live="polite">
          {spoken
            ? <p className="text-[13px] leading-5 text-violet-100">{spoken}</p>
            : <p className="text-[13px] leading-5 text-[#8e889b]">The public doors are still closed. Poke me if you like.</p>}
        </div>
      </div>
    </div>
  );
}
