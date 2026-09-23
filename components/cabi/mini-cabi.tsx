"use client";

import { useState } from "react";

export function MiniCabi({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      aria-label={decorative ? undefined : "Cabi — Cat Partner Unit"}
      aria-hidden={decorative}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border border-violet-300/20 bg-violet-400/10 ${className}`}
    >
      {/* The neutral monogram is visible until the official logo loads, so a
          missing asset never produces a broken-image placeholder. */}
      <span aria-hidden="true" className="relative text-[12px] font-black tracking-[-0.08em] text-violet-200">CA</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-logo.png"
        alt=""
        aria-hidden="true"
        width={1280}
        height={1280}
        decoding="async"
        draggable={false}
        className={`absolute inset-0 h-full w-full object-contain p-0.5 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </span>
  );
}
