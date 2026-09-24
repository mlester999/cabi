"use client";

import { CabiMascot } from "@/components/cabi/cabi-mascot";
import { usePrefersReducedMotion } from "@/components/cabi/particle-field";
import { useEffect, useMemo, useState } from "react";

/**
 * Indeterminate Cabi boot checks.
 *
 * There is deliberately no completion percentage: the site has no backend
 * value that would make one true, so every row animates as indefinite work.
 * The alternating dots are CSS-free and reduced-motion aware, and every row is
 * decorative (`aria-hidden`) because the real information is the plain text.
 */
const bootChecks = [
  { label: "Personality Core", state: "Preparing" },
  { label: "Memory", state: "Preparing" },
  { label: "Wallet Connection", state: "Preparing" },
  { label: "Clank.trade", state: "Preparing" },
  { label: "Cat Mode", state: "Always Ready" },
] as const;

const preparingText = ["Preparing...", "Preparing..", "Preparing."] as const;
const idleText = "Always Ready";

export function SystemStatus({
  statusLabel,
  rotation,
  className = "",
}: {
  statusLabel: string;
  rotation: readonly string[];
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setTick((value) => (value + 1) % 3), 1_050);
    return () => window.clearInterval(timer);
  }, [reduced]);

  useEffect(() => {
    if (reduced || rotation.length === 0) return;
    const timer = window.setInterval(() => setLine((value) => (value + 1) % rotation.length), 5_400);
    return () => window.clearInterval(timer);
  }, [reduced, rotation.length]);

  const rotationLine = rotation.length ? rotation[reduced ? 0 : line] : "";
  const dots = reduced ? preparingText[2] : preparingText[tick];

  return (
    <section className={`glass rounded-2xl p-4 sm:p-5 ${className}`} aria-label={`${statusLabel} status`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--cabi-primary)]">{statusLabel}</p>
        <p role="status" aria-live="polite" className="min-w-0 truncate text-[11px] text-[var(--cabi-text-muted)]">{rotationLine}</p>
      </div>

      <div className="cabi-indeterminate mt-4 h-px w-full rounded-full bg-[var(--cabi-surface-3)]" aria-hidden="true" />

      <ul className="mt-4 space-y-2.5">
        {bootChecks.map((check) => (
          <li key={check.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${check.state === "Preparing" ? "cabi-dot-pulse bg-violet-300" : "bg-emerald-300"}`}
              />
              <span className="truncate text-[var(--cabi-text-secondary)]">{check.label}</span>
            </span>
            <span className={`shrink-0 font-mono text-[11px] ${check.state === "Preparing" ? "text-[var(--cabi-primary)]/80" : "text-emerald-300/90"}`}>
              {check.state === "Preparing" ? dots : idleText}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Decorative boot log.
 *
 * The lines are fixed, playful copy — never a claim that real work finished.
 * They type in once, hold, and restart slowly; the whole panel is `aria-hidden`
 * so screen readers are not read a looping fake log.
 */
const terminalLines = [
  "booting cabi...",
  "loading personality...",
  "calibrating ears...",
  "initializing memory...",
  "connecting wallet module...",
  "learning clank.trade...",
  "meow_protocol: ready",
  "waiting for launch...",
] as const;

export function CabiTerminal({ className = "" }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(reduced ? terminalLines.length : 0);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let index = 0;
    let timer: number;
    const step = () => {
      if (cancelled) return;
      index += 1;
      setVisible(index);
      if (index <= terminalLines.length) {
        timer = window.setTimeout(step, 620);
      } else {
        timer = window.setTimeout(() => {
          if (cancelled) return;
          index = 0;
          setVisible(0);
          timer = window.setTimeout(step, 900);
        }, 7_200);
      }
    };
    timer = window.setTimeout(step, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [reduced]);

  return (
    <div data-cabi-terminal className={`rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-bg-deep)]/70 p-4 ${className}`} aria-hidden="true">
      <p className="font-mono text-[10px] leading-5 text-[var(--cabi-text-faint)]">
        <span className="text-[var(--cabi-primary)]/70">cabi@unit</span>:<span className="text-[var(--cabi-text-faint)]">~</span>$ boot --prelaunch
      </p>
      <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-5">
        {terminalLines.slice(0, visible).map((line, index) => (
          <p key={line} className={index === visible - 1 && visible <= terminalLines.length ? "cabi-caret text-[var(--cabi-text-secondary)]" : "text-[var(--cabi-text-muted)]"}>
            <span className="text-violet-400/60">&gt; </span>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

const easterEggs = [
  "Still working on it...",
  "Okay okay, I'm going as fast as I can.",
  "pspsps... wait, that's supposed to work on me?",
  "One more nap and then I'll finish, promise.",
  "My ears are calibrated. My brain is almost there.",
] as const;

/**
 * Mascot + speech bubble.
 *
 * Cabi sits with the status list, blinks and twitches on her own, and answers
 * clicks with a short queue of lines. Clicking again advances the line, so the
 * easter eggs stay an opt-in discovery rather than a popup.
 */
export function CabiMascotSpot({ className = "", checks = bootChecks.length }: { className?: string; checks?: number }) {
  const [index, setIndex] = useState(-1);
  const line = index < 0 ? null : easterEggs[index % easterEggs.length];

  const spoken = useMemo(() => line, [line]);

  return (
    <div className={`relative flex items-end gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => setIndex((value) => (value + 1) % easterEggs.length)}
        aria-label={spoken ? `Cabi says: ${spoken}. Activate for another line.` : "Cabi, your Cat Partner Unit. Activate to hear from her."}
        className="focus-ring group relative grid h-[74px] w-[74px] shrink-0 place-items-center rounded-2xl border border-violet-200/[0.13] bg-[var(--cabi-bg-deep)]/80 transition hover:border-violet-200/25 hover:bg-violet-300/[0.06] sm:h-[86px] sm:w-[86px]"
      >
        <span aria-hidden="true" className="absolute inset-0 rounded-2xl bg-violet-400/[0.10] blur-xl" />
        <CabiMascot className="relative h-[58px] w-[58px] sm:h-[68px] sm:w-[68px]" />
      </button>

      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[11px] uppercase tracking-[.2em] text-[var(--cabi-text-faint)]">Cat Mode</p>
        <div
          className="mt-1.5 min-h-[42px] rounded-2xl rounded-bl-md border border-violet-200/[0.12] bg-violet-300/[0.05] px-3.5 py-2.5"
          role={spoken ? "status" : undefined}
          aria-live="polite"
        >
          {spoken
            ? <p className="text-[13px] leading-5 text-[var(--cabi-text-secondary)]">{spoken}</p>
            : <p className="text-[13px] leading-5 text-[var(--cabi-text-muted)]">{checks} systems preparing. Poke me if you like.</p>}
        </div>
      </div>
    </div>
  );
}
