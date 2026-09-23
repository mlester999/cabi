/**
 * Feature flags.
 *
 * Isomorphic on purpose: the server resolves them and the UI reads the resolved
 * values, but the *defaults* live here so both sides agree.
 *
 * The rule this file exists to enforce: a flag is never trusted from the
 * browser. Flags are read server-side from `app_settings` and passed down as
 * props or returned by an API route; nothing reads a flag out of a request body,
 * a query parameter, or client storage.
 */

export const featureFlagKeys = [
  "chat_enabled",
  "image_generation_enabled",
  "wallet_auth_enabled",
  "memory_enabled",
  "profile_enabled",
  "ranking_enabled",
  "leaderboard_enabled",
  "portfolio_enabled",
  "direct_trading_enabled",
  "rewards_enabled",
  "gallery_enabled",
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

/**
 * What ships in this phase.
 *
 * The five core surfaces are on. Everything that is half-built is off, and the
 * UI presents those as intentionally unreleased rather than broken.
 */
export const defaultFeatureFlags: FeatureFlags = {
  // Core experience.
  chat_enabled: true,
  image_generation_enabled: true,
  wallet_auth_enabled: true,
  memory_enabled: true,
  profile_enabled: true,

  // Not ready. Architecture is preserved; the flows are closed.
  ranking_enabled: false,
  leaderboard_enabled: false,
  portfolio_enabled: false,
  direct_trading_enabled: false,
  rewards_enabled: false,
  // Image history lives inside the profile for now, not as its own destination.
  gallery_enabled: false,
};

/** Copy for the locked cards. Never claims a feature works. */
export const lockedFeatureCopy: Record<string, { title: string; description: string }> = {
  leaderboard_enabled: { title: "Leaderboard", description: "Weekly and monthly rankings" },
  ranking_enabled: { title: "Ranks", description: "Seasonal progress and tiers" },
  portfolio_enabled: { title: "Portfolio", description: "See your wallet through Cabi" },
  direct_trading_enabled: { title: "Automated Trading", description: "Tell Cabi what you want to trade" },
  rewards_enabled: { title: "Rewards", description: "Community rewards for real activity" },
  gallery_enabled: { title: "Gallery", description: "Every image Cabi has made for you" },
};

/** The features presented as "in the works", in display order. */
export const lockedFeatureOrder = [
  "leaderboard_enabled",
  "ranking_enabled",
  "portfolio_enabled",
  "direct_trading_enabled",
  "rewards_enabled",
  "gallery_enabled",
] as const;

export function parseFeatureFlags(value: unknown): FeatureFlags {
  const source = (value ?? {}) as Record<string, unknown>;
  const flags = { ...defaultFeatureFlags };
  for (const key of featureFlagKeys) {
    // Only a real boolean overrides the default. A string "false" from a
    // hand-edited settings row must not turn a feature on.
    if (typeof source[key] === "boolean") flags[key] = source[key];
  }
  return flags;
}