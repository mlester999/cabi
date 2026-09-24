"use client";

import { useEffect, useState } from "react";

/**
 * Season countdown.
 *
 * The deadline is a server timestamp, so the timer is anchored to real data
 * rather than guessed from the browser clock or timezone. Only the ticking text
 * is hidden from assistive technology; a static, descriptive alternative is
 * exposed instead, so a screen reader is not re-announced every second.
 */
export function SeasonCountdown({ endsAt, onElapsed }: { endsAt: string; onElapsed?: () => void }) {
  const deadline = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, deadline - Date.now());
      setRemaining(next);
      if (next === 0) onElapsed?.();
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [deadline, onElapsed]);

  const totalSeconds = Math.floor(remaining / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (remaining <= 0) {
    return (
      <span className="font-mono text-[12px] font-semibold text-amber-200" role="status">
        Finalizing...
      </span>
    );
  }

  const text = days > 0
    ? `${days}D ${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`
    : `${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`;

  return (
    <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--cabi-primary)]">
      {/* The live digits are decorative to assistive tech; the static label carries the meaning. */}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{`Season ends ${new Date(endsAt).toUTCString()}`}</span>
    </span>
  );
}