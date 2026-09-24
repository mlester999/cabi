"use client";

import { rankTiers, type RankTier } from "@/lib/ranking/tiers";

/**
 * Rank badge.
 *
 * Six tiers with a rising visual weight, kept inside the Cabi palette: gray for
 * Novice through to a gold-accented Legend. No medals, no clip art.
 */
export function RankBadge({ tier, size = "md", showLabel = true }: { tier: RankTier; size?: "sm" | "md" | "lg"; showLabel?: boolean }) {
  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : size === "lg" ? "px-3 py-1 text-[12px]" : "px-2.5 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-[.12em] ${tier.badgeClass} ${padding}`}
      // Screen readers get the full tier, not the decorative styling.
      aria-label={`Rank: ${tier.label}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tier.accent }} />
      {showLabel ? tier.label : null}
    </span>
  );
}

/** The progress bar toward the next tier. */
export function RankProgressBar({ percent, accent, label }: { percent: number; accent: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--cabi-surface-3)]"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress to the next rank"}
    >
      <div className="h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${clamped}%`, backgroundColor: accent }} />
    </div>
  );
}

/** A compact avatar with a CSS initials fallback. No image file is generated. */
export function InitialsAvatar({ initials, src, size = 36, label }: { initials: string; src?: string | null; size?: number; label: string }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-violet-200/[0.18] bg-gradient-to-br from-violet-400/[0.22] to-violet-300/[0.06] font-semibold text-violet-50"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-label={label}
      role="img"
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs are not routable through next/image.
        ? <img src={src} alt="" className="h-full w-full object-cover" />
        : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}

/**
 * The chat header identity chip: avatar, username, rank. Deliberately one line
 * so it does not crowd the conversation.
 */
export function RankChip({ username, initials, avatarUrl, tier, onClick }: {
  username: string;
  initials: string;
  avatarUrl?: string | null;
  tier: RankTier;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${username}, rank ${tier.label}. Open your profile.`}
      className="focus-ring flex max-w-[220px] items-center gap-2 rounded-full border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] py-1 pl-1 pr-2.5 text-left transition hover:bg-[var(--cabi-surface-3)]"
    >
      <InitialsAvatar initials={initials} src={avatarUrl} size={26} label={`${username} avatar`} />
      <span className="min-w-0 truncate text-[12px] font-semibold text-white">{username}</span>
      <RankBadge tier={tier} size="sm" />
    </button>
  );
}

export { rankTiers };