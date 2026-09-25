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
  "achievements_enabled",
  "gallery_enabled",
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export type CabiFeatureSurface = "active" | "roadmap" | "supporting";

export type CabiFeatureDefinition = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** A stable icon name keeps the registry serializable across server/client boundaries. */
  readonly icon: string;
  /** Some active product surfaces, such as $CPU, are not separately gated. */
  readonly flag: FeatureFlagKey | null;
  readonly surface: CabiFeatureSurface;
  readonly route?: string;
};

/**
 * The product roadmap registry.
 *
 * This is the single source for Lab cards, locked route copy, profile previews,
 * and the admin flag labels. Keep icons as names rather than React elements so
 * the registry can be read by server components and passed to client cards.
 */
export const CABI_FEATURES = [
  { id: "chat", label: "Chat", description: "Talk naturally with Cabi.", icon: "message-circle", flag: "chat_enabled", surface: "active", route: "/" },
  { id: "image-generation", label: "Image Generation", description: "Make Cabi images from the conversation.", icon: "image", flag: "image_generation_enabled", surface: "active", route: "/" },
  { id: "wallet", label: "EVM Wallet", description: "Use your wallet as your Cabi identity.", icon: "wallet-cards", flag: "wallet_auth_enabled", surface: "active", route: "/" },
  { id: "profile", label: "Profile", description: "Choose your name and optional photo.", icon: "user-round", flag: "profile_enabled", surface: "active", route: "/profile" },
  { id: "memory", label: "Memory", description: "Keep the moments you want Cabi to remember.", icon: "brain", flag: "memory_enabled", surface: "active", route: "/settings/memory" },
  { id: "cpu", label: "$CPU", description: "The Cat Partner Unit access page.", icon: "cpu", flag: null, surface: "active", route: "/cpu" },

  { id: "leaderboard", label: "Leaderboard", description: "Weekly and monthly rankings.", icon: "trophy", flag: "leaderboard_enabled", surface: "active", route: "/leaderboard" },
  { id: "ranks", label: "Ranks", description: "Lifetime progress through six Cabi ranks.", icon: "medal", flag: "ranking_enabled", surface: "active", route: "/profile" },
  { id: "portfolio", label: "Portfolio", description: "See your wallet through Cabi.", icon: "briefcase-business", flag: "portfolio_enabled", surface: "roadmap", route: "/portfolio" },
  { id: "automated-trading", label: "Automated Trading", description: "Tell Cabi what you want to trade.", icon: "bot", flag: "direct_trading_enabled", surface: "roadmap", route: "/trading" },
  { id: "rewards", label: "Rewards", description: "Community rewards for real activity.", icon: "gift", flag: "rewards_enabled", surface: "roadmap", route: "/rewards" },
  { id: "achievements", label: "Achievements", description: "Permanent milestones from time spent with Cabi.", icon: "award", flag: "achievements_enabled", surface: "roadmap", route: "/achievements" },

  // Gallery remains a supporting route for the existing image history work. It
  // is intentionally not part of the six-card public roadmap brief.
  { id: "gallery", label: "Gallery", description: "Every image Cabi has made for you.", icon: "images", flag: "gallery_enabled", surface: "supporting", route: "/gallery" },
] as const satisfies ReadonlyArray<CabiFeatureDefinition>;

export const cabiRoadmapFeatures = CABI_FEATURES.filter((feature) => feature.surface === "roadmap");
export const roadmapFeatureCount = cabiRoadmapFeatures.length;

export function cabiFeatureForFlag(flag: FeatureFlagKey): CabiFeatureDefinition | undefined {
  return CABI_FEATURES.find((feature) => feature.flag === flag);
}

/**
 * What ships in this phase.
 *
 * The core Cabi experience, rank progression, and leaderboards are on.
 * Future wallet and reward surfaces remain off and are shown in Cabi Lab.
 */
export const defaultFeatureFlags: FeatureFlags = {
  // Core experience.
  chat_enabled: true,
  image_generation_enabled: true,
  wallet_auth_enabled: true,
  memory_enabled: true,
  profile_enabled: true,

  // Active progression features.
  ranking_enabled: true,
  leaderboard_enabled: true,
  portfolio_enabled: false,
  direct_trading_enabled: false,
  rewards_enabled: false,
  achievements_enabled: false,
  // Image history lives inside the profile for now, not as its own destination.
  gallery_enabled: false,
};

/** Copy for the locked cards. Never claims a feature works. */
export const lockedFeatureCopy: Record<string, { title: string; description: string }> = Object.fromEntries(
  CABI_FEATURES
    .filter((feature) => feature.surface !== "active" && feature.flag)
    .map((feature) => [feature.flag, { title: feature.label, description: feature.description }]),
);

/** All lockable flags, including supporting routes that are not Lab cards. */
export const lockedFeatureOrder: ReadonlyArray<FeatureFlagKey> = CABI_FEATURES
  .filter((feature) => feature.surface !== "active" && feature.flag)
  .map((feature) => feature.flag as FeatureFlagKey);

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
