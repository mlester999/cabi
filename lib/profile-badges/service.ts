import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { normalizeUsername } from "@/lib/profiles/username";

export type ProfileBadge = {
  id: string;
  slug: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  awardedAt: string;
  isShowcased: boolean;
};

export type LeaderboardBadge = Pick<ProfileBadge, "label" | "icon" | "color">;

const columns = "id,slug,label,description,icon_key,color_key";

/** Returns badges actually assigned to one wallet account. */
export async function readProfileBadges(walletAccountId: string): Promise<{ badges: ProfileBadge[]; available: boolean }> {
  const db = getServiceClient();
  if (!db) return { badges: [], available: false };
  const { data: awards, error: awardsError } = await db.from("cabi_profile_badge_awards")
    .select("badge_id,assigned_at,is_showcased")
    .eq("wallet_account_id", walletAccountId)
    .order("assigned_at", { ascending: true });
  if (awardsError) return { badges: [], available: false };
  if (!awards?.length) return { badges: [], available: true };

  const ids = awards.map((award) => String(award.badge_id));
  const { data: definitions, error: definitionsError } = await db.from("cabi_profile_badges").select(columns).in("id", ids);
  if (definitionsError) return { badges: [], available: false };
  const byId = new Map((definitions ?? []).map((badge) => [String(badge.id), badge as Record<string, unknown>]));
  return {
    available: true,
    badges: awards.flatMap((award) => {
      const badge = byId.get(String(award.badge_id));
      if (!badge) return [];
      return [{
        id: String(badge.id),
        slug: String(badge.slug),
        label: String(badge.label),
        description: String(badge.description ?? ""),
        icon: String(badge.icon_key),
        color: String(badge.color_key),
        awardedAt: String(award.assigned_at),
        isShowcased: Boolean(award.is_showcased),
      }];
    }),
  };
}

/** Public profile output is limited to the three badges the owner chose to show. */
export async function readPublicProfileBadges(username: string): Promise<ProfileBadge[]> {
  const normalized = normalizeUsername(username);
  const db = getServiceClient();
  if (!normalized || !db) return [];
  const { data: profile, error } = await db.from("profiles")
    .select("wallet_account_id,ranking_status")
    .eq("username", normalized)
    .maybeSingle();
  if (error || !profile || profile.ranking_status === "INELIGIBLE") return [];
  const result = await readProfileBadges(String(profile.wallet_account_id));
  return result.available ? result.badges.filter((badge) => badge.isShowcased).slice(0, 3) : [];
}

/** One selected badge per public leaderboard row; account IDs never leave the server. */
export async function readLeaderboardBadgeMap(walletAccountIds: string[]): Promise<Map<string, LeaderboardBadge>> {
  const ids = [...new Set(walletAccountIds.filter(Boolean))];
  const db = getServiceClient();
  if (!db || ids.length === 0) return new Map();
  const { data: awards, error } = await db.from("cabi_profile_badge_awards")
    .select("wallet_account_id,badge_id,assigned_at")
    .in("wallet_account_id", ids)
    .eq("is_showcased", true)
    .order("assigned_at", { ascending: true });
  if (error || !awards?.length) return new Map();
  const badgeIds = [...new Set(awards.map((award) => String(award.badge_id)))];
  const { data: definitions, error: definitionError } = await db.from("cabi_profile_badges").select(columns).in("id", badgeIds);
  if (definitionError) return new Map();
  const byId = new Map((definitions ?? []).map((badge) => [String(badge.id), badge as Record<string, unknown>]));
  const result = new Map<string, LeaderboardBadge>();
  for (const award of awards) {
    const accountId = String(award.wallet_account_id);
    if (result.has(accountId)) continue;
    const badge = byId.get(String(award.badge_id));
    if (!badge) continue;
    result.set(accountId, { label: String(badge.label), icon: String(badge.icon_key), color: String(badge.color_key) });
  }
  return result;
}

export async function saveProfileBadgeShowcase(walletAccountId: string, badgeIds: string[]): Promise<boolean> {
  const db = getServiceClient();
  if (!db) return false;
  const { data, error } = await db.rpc("set_profile_badge_showcase", {
    p_wallet_account_id: walletAccountId,
    p_badge_ids: badgeIds,
  });
  return !error && Boolean(data);
}
