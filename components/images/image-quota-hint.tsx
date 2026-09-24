"use client";

import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";

/**
 * The daily image allowance, shown subtly.
 *
 * Fetched rather than passed in, because the limit is admin-configured: a cached
 * or hardcoded number would go stale the moment the owner changes it. The count
 * comes from the same database function the generation endpoint enforces, so the
 * two cannot disagree.
 *
 * Renders nothing while loading, so it can be dropped into a sidebar without a
 * placeholder flash.
 */
type Quota = { used: number; remaining: number; dailyLimit: number; allowed: boolean };

export function ImageQuotaHint({ className = "" }: { className?: string }) {
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch("/api/profile/images", { cache: "no-store" })
        .then(async (response) => (response.ok ? await response.json() as { quota?: Quota } : null))
        .then((payload) => { if (!cancelled && payload?.quota) setQuota(payload.quota); })
        .catch(() => undefined);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  if (!quota || quota.dailyLimit <= 0) return null;

  return (
    <p
      className={`flex items-center gap-1.5 text-[10px] text-[#777180] ${className}`}
      // One labelled value rather than a live region, so a screen reader is not
      // re-announced on every render.
      aria-label={`Cabi images: ${quota.used} of ${quota.dailyLimit} used today`}
    >
      <ImagePlus size={11} aria-hidden="true" />
      <span aria-hidden="true">
        Cabi Images{" "}
        <span className={quota.remaining === 0 ? "text-amber-200" : "text-[#a8a3b3]"}>
          {quota.used} / {quota.dailyLimit} used today
        </span>
      </span>
    </p>
  );
}