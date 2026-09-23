/**
 * The six rank tiers.
 *
 * RANK is deliberately separate from BOND:
 * - BOND is the relationship with Cabi and never resets.
 * - RANK is competitive, monthly, and resets with the season.
 *
 * Rank is earned only from product activity. It must never depend on owning
 * $CPU, wallet balance, trading volume, or token value - the XP evaluator has no
 * access to any of those, and the database function only accepts activity
 * signals. Keeping wealth out of rank is a product guarantee, not a preference.
 */

export type RankTierKey = "NOVICE" | "EXPLORER" | "COMPANION" | "ELITE" | "MASTER" | "LEGEND";

export type RankTier = {
  tier: number;
  key: RankTierKey;
  label: string;
  /** Monthly XP required to reach this tier. */
  threshold: number;
  /** Badge styling. Lavender family, escalating, no game-y clutter. */
  badgeClass: string;
  /** Solid accent, used for progress bars and the share card. */
  accent: string;
  /** Whether the badge gets the premium animated treatment. */
  premium: boolean;
};

/**
 * Default monthly thresholds.
 *
 * These are intentionally steep at the top: LEGEND is meant to be rare. They are
 * defaults only - each season freezes the thresholds in force when it was
 * created, and the owner can edit them in admin.
 */
export const defaultRankThresholds: Record<Exclude<RankTierKey, "NOVICE">, number> = {
  EXPLORER: 500,
  COMPANION: 1_500,
  ELITE: 4_000,
  MASTER: 9_000,
  LEGEND: 18_000,
};

export const rankTiers: readonly RankTier[] = [
  { tier: 1, key: "NOVICE", label: "Novice", threshold: 0, badgeClass: "border-white/[0.12] bg-white/[0.04] text-[#c9c4d4]", accent: "#a1a1aa", premium: false },
  { tier: 2, key: "EXPLORER", label: "Explorer", threshold: 500, badgeClass: "border-violet-200/[0.22] bg-violet-300/[0.08] text-violet-100", accent: "#c4b5fd", premium: false },
  { tier: 3, key: "COMPANION", label: "Companion", threshold: 1_500, badgeClass: "border-indigo-300/[0.24] bg-indigo-300/[0.09] text-indigo-100", accent: "#a5b4fc", premium: false },
  { tier: 4, key: "ELITE", label: "Elite", threshold: 4_000, badgeClass: "border-violet-300/[0.32] bg-violet-400/[0.12] text-violet-50", accent: "#8b5cf6", premium: false },
  { tier: 5, key: "MASTER", label: "Master", threshold: 9_000, badgeClass: "border-fuchsia-300/[0.30] bg-fuchsia-400/[0.12] text-fuchsia-50", accent: "#d8b4fe", premium: true },
  { tier: 6, key: "LEGEND", label: "Legend", threshold: 18_000, badgeClass: "border-amber-200/[0.34] bg-gradient-to-r from-amber-200/[0.14] to-violet-300/[0.14] text-amber-50", accent: "#fcd34d", premium: true },
] as const;

/** Tier for an XP total, using the season's frozen thresholds. */
export function tierForXp(xp: number, thresholds: Partial<Record<RankTierKey, number>> = {}): RankTier {
  const resolved = { ...defaultRankThresholds, ...thresholds } as Record<Exclude<RankTierKey, "NOVICE">, number>;
  let match = rankTiers[0];
  for (const tier of rankTiers) {
    const required = tier.key === "NOVICE" ? 0 : resolved[tier.key as Exclude<RankTierKey, "NOVICE">];
    if (typeof required === "number" && xp >= required) match = tier;
  }
  return match;
}

export function tierByNumber(tier: number): RankTier {
  return rankTiers.find((item) => item.tier === tier) ?? rankTiers[0];
}

export function tierByKey(key: string): RankTier | null {
  const normalized = key.trim().toUpperCase();
  return rankTiers.find((item) => item.key === normalized) ?? null;
}

export type RankProgress = {
  current: RankTier;
  next: RankTier | null;
  xp: number;
  /** XP still needed for `next`. Zero once at the top tier. */
  toNext: number;
  /** Percent progress from the current threshold to the next. */
  percent: number;
};

export function rankProgress(xp: number, thresholds: Partial<Record<RankTierKey, number>> = {}): RankProgress {
  const safe = Math.max(0, Math.floor(xp));
  const current = tierForXp(safe, thresholds);
  const next = rankTiers.find((tier) => tier.tier === current.tier + 1) ?? null;
  if (!next) return { current, next: null, xp: safe, toNext: 0, percent: 100 };
  const span = next.threshold - current.threshold;
  const gained = safe - current.threshold;
  return {
    current,
    next,
    xp: safe,
    toNext: Math.max(0, next.threshold - safe),
    percent: span > 0 ? Math.max(0, Math.min(100, Math.round((gained / span) * 100))) : 0,
  };
}

export function rankUpMessage(tier: RankTier): string {
  switch (tier.key) {
    case "EXPLORER": return "Okayyy, Explorer. You're actually sticking around.";
    case "COMPANION": return "Companion. I like the sound of that.";
    case "ELITE": return "Okayyy, Elite looks good on you.";
    case "MASTER": return "Master. Show-off. I'm impressed though.";
    case "LEGEND": return "Legend. I knew you had it in you.";
    default: return "Nice, you're moving up.";
  }
}