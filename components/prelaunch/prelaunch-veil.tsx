"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { veilAttribute, veilFadeMs, veilTimeoutMs } from "@/lib/site/veil";
import { useEffect, useState } from "react";

/**
 * Short branded first-paint transition.
 *
 * The veil is hidden by default, so the server and client markup always match
 * and a repeat navigation never flashes it. A tiny inline script in the root
 * layout tags `<html data-cabi-veil>` before first paint only for the first
 * visit in the session; this component removes that tag as soon as React has
 * hydrated. It never adds artificial waiting beyond hydration.
 */
export function PrelaunchVeil() {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute(veilAttribute)) return;
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setFading(true);
      window.setTimeout(() => root.removeAttribute(veilAttribute), veilFadeMs);
    };
    const timer = window.setTimeout(dismiss, veilTimeoutMs);
    return () => {
      window.clearTimeout(timer);
      dismiss();
    };
  }, []);

  return (
    <div
      className={`cabi-veil transition-opacity duration-200 motion-reduce:transition-none ${fading ? "pointer-events-none opacity-0" : "opacity-100"}`}
      aria-hidden="true"
    >
      <div className="flex flex-col items-center">
        <span className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 rounded-full bg-violet-400/20 blur-2xl" />
          <MiniCabi className="relative h-12 w-12 rounded-[15px]" decorative />
        </span>
        <p className="mt-5 text-[13px] font-bold tracking-[.34em] text-violet-100">CABI</p>
        <span className="cabi-indeterminate mt-3 block h-px w-24 overflow-hidden rounded-full bg-white/10" />
      </div>
    </div>
  );
}
