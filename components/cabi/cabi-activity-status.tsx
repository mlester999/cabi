"use client";

import {
  cabiStatusAnnouncements,
  resolveStatusMessages,
  type CabiStatusOverrides,
  type CabiStatusType,
} from "@/lib/cabi/status-messages";
import { useEffect, useState } from "react";

/**
 * The one activity indicator for the whole application.
 *
 * Every "Cabi is working" surface renders this, so the mascot, the animation, the
 * activity copy, and the accessibility behaviour cannot drift between chat,
 * image generation, wallet sign-in, memory reads, and profile saves.
 *
 * Four things it deliberately does NOT do:
 *
 * - **No fake progress.** The bar is indeterminate because no provider reports a
 *   completion percentage. There is no number anywhere in the markup.
 * - **No layout jump.** The row has a fixed minimum height, so swapping a line of
 *   text never moves what is below it.
 * - **No screen-reader spam.** The visible copy is decorative and a single
 *   stable sentence in a polite live region does the announcing.
 * - **No motion when asked not to.** `prefers-reduced-motion` removes the
 *   animation and the transitional fade, and leaves the messages working.
 */
export function CabiActivityStatus({
  type,
  overrides,
  label,
  className = "",
  mascot = true,
  compact = false,
}: {
  type: CabiStatusType;
  /** Owner-added lines, appended to the built-in defaults. */
  overrides?: CabiStatusOverrides | null;
  /** Overrides the stable screen-reader sentence. */
  label?: string;
  className?: string;
  mascot?: boolean;
  compact?: boolean;
}) {
  const messages = resolveStatusMessages(type, overrides);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);
  // Keep one calm sentence on screen. The previous rotating catalogue made a
  // single request look like several loaders stacked on top of each other.
  const ownerMessage = overrides?.[type]?.find((message) => message.trim().length > 0 && message.length <= 120);
  const visible = ownerMessage ?? messages[0] ?? cabiStatusAnnouncements[type];
  const announcement = label ?? cabiStatusAnnouncements[type];

  return (
    <div className={`flex min-h-[18px] items-center gap-2 ${className}`} data-cabi-status={type}>
      {mascot && (
        <span
          aria-hidden="true"
          className={`relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-violet-300/20 bg-violet-400/10 ${compact ? "h-6 w-6" : "h-[28px] w-7"} ${reducedMotion ? "" : "cabi-mascot-breathe"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/cabi-mascot.png"
            alt=""
            width={512}
            height={512}
            className="h-full w-full object-contain p-[1px]"
            draggable={false}
          />
        </span>
      )}

      {/* Visible, decorative; the stable live region below does the announcing. */}
      <span
        aria-hidden="true"
        className={`min-w-0 flex-1 truncate text-[var(--cabi-text-secondary)] ${compact ? "text-[11px]" : "text-xs"}`}
      >
        {visible}
        <IndeterminateBar reducedMotion={reducedMotion} />
      </span>

      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </div>
  );
}

/**
 * An indeterminate activity bar.
 *
 * Rendered as one animated sliver rather than a filling bar so it cannot be read
 * as "76% done". With reduced motion it becomes a static hairline, which still
 * says "working" without moving.
 */
function IndeterminateBar({ reducedMotion }: { reducedMotion: boolean }) {
  if (reducedMotion) {
    return <span aria-hidden="true" className="mt-1 block h-[2px] w-full rounded-full bg-violet-300/25" />;
  }
  return (
    <span aria-hidden="true" className="mt-1 block h-[2px] w-full overflow-hidden rounded-full bg-[var(--cabi-surface-3)]">
      <span className="cabi-activity-slide block h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
    </span>
  );
}
