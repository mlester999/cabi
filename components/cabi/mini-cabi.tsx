"use client";

import { useState } from "react";

export function MiniCabi({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border border-violet-300/20 bg-violet-400/10 ${className}`}>
      <span aria-label={decorative ? undefined : "Cabi"} aria-hidden={decorative} className="relative text-[12px] font-black tracking-[-0.08em] text-violet-200 before:absolute before:-left-1 before:-top-2 before:h-2 before:w-2 before:rotate-45 before:rounded-[2px] before:bg-violet-300/65 after:absolute after:-right-1 after:-top-2 after:h-2 after:w-2 after:rotate-45 after:rounded-[2px] after:bg-violet-300/65">CA</span>
      {/* The neutral monogram is visible until the owner-supplied asset loads, so a
          missing optional file never produces a broken-image placeholder. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cabi-mascot.png"
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full object-contain p-1 transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </span>
  );
}
