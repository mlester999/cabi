"use client";

import { useState } from "react";

export function MiniCabi({ className = "", decorative = false, priority = false }: { className?: string; decorative?: boolean; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-label={decorative ? undefined : "Cabi — Cat Partner Unit"}
      aria-hidden={decorative}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-violet-300/20 bg-violet-400/10 ${className}`}
    >
      {/* The monogram stays underneath the official mark as a resilient fallback. */}
      <span aria-hidden="true" className="relative z-0 text-[12px] font-black tracking-[-0.08em] text-[var(--cabi-primary)]">CA</span>
      {/* The supplied official close-up mark is shared across chat, preview, and admin surfaces. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-logo.png"
        alt=""
        aria-hidden="true"
        width={1254}
        height={1254}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        draggable={false}
        className={`absolute inset-0 z-10 h-full w-full object-contain p-0.5 ${failed ? "hidden" : "block"}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
