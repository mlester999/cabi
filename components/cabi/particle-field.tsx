"use client";

import { useEffect, useState } from "react";

export type Sparkle = { left: string; top: string; size: number; delay: string; duration: string };

const sparkleSeeds: Array<[number, number, number, number]> = [
  [18, 22, 3, 0], [72, 16, 4, 2.6], [34, 62, 3, 5.1], [86, 54, 3, 7.4],
  [12, 46, 4, 3.3], [60, 74, 3, 9.2], [46, 12, 3, 11.4], [92, 34, 4, 1.5],
  [26, 84, 3, 6.8], [68, 40, 3, 8.6], [8, 68, 3, 4.4], [52, 44, 4, 12.1],
];

export const sparkles: Sparkle[] = sparkleSeeds.map(([left, top, size, delay]) => ({
  left: `${left}%`,
  top: `${top}%`,
  size,
  delay: `${delay}s`,
  duration: `${11 + (size % 3) * 2.5}s`,
}));

/**
 * Deterministic field of slow-rising lavender motes.
 *
 * Positions come from a fixed seed table rather than `Math.random()` so the
 * server and client markup agree and no hydration mismatch is possible. The
 * field is always rendered; `prefers-reduced-motion` freezes the motes in
 * place as a faint static glow via CSS.
 */
export function ParticleField({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {sparkles.map((sparkle, index) => (
        <span
          key={index}
          className="cabi-sparkle absolute rounded-full bg-violet-200"
          style={{
            left: sparkle.left,
            top: sparkle.top,
            width: sparkle.size,
            height: sparkle.size,
            animationDelay: sparkle.delay,
            animationDuration: sparkle.duration,
            boxShadow: "0 0 10px rgba(196,181,253,.75)",
          }}
        />
      ))}
    </div>
  );
}

/** Reduced-motion gate for decorative components. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
