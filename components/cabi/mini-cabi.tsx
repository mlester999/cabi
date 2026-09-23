"use client";

import { useState } from "react";

export function MiniCabi({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-label={decorative ? undefined : "Cabi — Cat Partner Unit"}
      aria-hidden={decorative}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border border-violet-300/20 bg-violet-400/10 ${className}`}
    >
      {/* The monogram stays underneath the official mark as a resilient fallback. */}
      <span aria-hidden="true" className="relative z-0 text-[12px] font-black tracking-[-0.08em] text-violet-200">CA</span>
      {/*
        The mascot render, not the full logo: this element is used at 26-40px in
        every chat message, and the logo asset is a 2858 KB 1254x1254 file. The
        mascot is the same character at 400x400 and 68 KB, so a conversation no
        longer downloads megabytes of avatar it renders at thumbnail size.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-mascot.png"
        alt=""
        aria-hidden="true"
        width={400}
        height={400}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`absolute inset-0 z-10 h-full w-full object-contain p-0.5 ${failed ? "hidden" : "block"}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
