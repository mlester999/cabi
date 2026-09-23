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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-logo.png"
        alt=""
        aria-hidden="true"
        width={1280}
        height={1280}
        decoding="async"
        draggable={false}
        className={`absolute inset-0 z-10 h-full w-full object-contain p-0.5 ${failed ? "hidden" : "block"}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
