import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { initialsFor, normalizeUsername, validateUsername } from "@/lib/profiles/username";

/**
 * Profile service.
 *
 * The profile is the public identity of a wallet account. It exists because the
 * leaderboard must never show a wallet address, and because Cabi needs something
 * human to call the user.
 *
 * Everything here is scoped by `wallet_account_id`, which the caller obtains from
 * the verified session cookie. No function in this module accepts an owner id
 * from a request body.
 */

export type ProfileRecord = {
  walletAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  preferredName: string | null;
  profileCompletedAt: string | null;
  showBondPublicly: boolean;
  rankingStatus: "NORMAL" | "REVIEW" | "INELIGIBLE";
  lifetimeXp: number;
  bestRankTier: number | null;
  bestLeaderboardPosition: number | null;
  createdAt: string | null;
};

export type ProfileSetupInput = {
  username: string;
  displayName?: string | null;
  avatarPath?: string | null;
  showBondPublicly?: boolean;
};

const columns = "wallet_account_id,username,display_name,avatar_path,preferred_name,profile_completed_at,show_bond_publicly,ranking_status,lifetime_xp,best_rank_tier,best_leaderboard_position,created_at";

function toRecord(row: Record<string, unknown> | null): ProfileRecord | null {
  if (!row) return null;
  return {
    walletAccountId: String(row.wallet_account_id),
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    avatarPath: (row.avatar_path as string | null) ?? null,
    preferredName: (row.preferred_name as string | null) ?? null,
    profileCompletedAt: (row.profile_completed_at as string | null) ?? null,
    showBondPublicly: Boolean(row.show_bond_publicly),
    rankingStatus: (row.ranking_status as ProfileRecord["rankingStatus"]) ?? "NORMAL",
    lifetimeXp: Number(row.lifetime_xp ?? 0),
    bestRankTier: row.best_rank_tier == null ? null : Number(row.best_rank_tier),
    bestLeaderboardPosition: row.best_leaderboard_position == null ? null : Number(row.best_leaderboard_position),
    createdAt: (row.created_at as string | null) ?? null,
  };
}

export async function readProfile(walletAccountId: string): Promise<ProfileRecord | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db.from("profiles").select(columns).eq("wallet_account_id", walletAccountId).maybeSingle();
  return toRecord(data as Record<string, unknown> | null);
}

/** True once the account has claimed a username. Gates the social features. */
export function isProfileComplete(profile: ProfileRecord | null): boolean {
  return Boolean(profile?.profileCompletedAt && profile.username);
}

export type ProfileSetupResult =
  | { ok: true; profile: ProfileRecord }
  | { ok: false; reason: "INVALID_USERNAME" | "USERNAME_TAKEN" | "SAVE_FAILED" | "DATABASE_NOT_CONFIGURED"; message: string };

/**
 * Claims a username and completes the profile.
 *
 * Uniqueness is enforced by the database index rather than a read-then-write
 * check, so two accounts cannot both take a handle in a race. A unique violation
 * is reported as USERNAME_TAKEN.
 */
export async function completeProfile(walletAccountId: string, input: ProfileSetupInput): Promise<ProfileSetupResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, reason: "DATABASE_NOT_CONFIGURED", message: "Cabi's memory connection isn't configured yet." };

  const validated = validateUsername(input.username);
  if (!validated.ok) return { ok: false, reason: "INVALID_USERNAME", message: validated.message };

  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 40) : null;

  const { data, error } = await db
    .from("profiles")
    .update({
      username: validated.username,
      display_name: displayName || null,
      avatar_path: input.avatarPath ?? null,
      preferred_name: displayName || validated.username,
      show_bond_publicly: Boolean(input.showBondPublicly),
      profile_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("wallet_account_id", walletAccountId)
    .select(columns)
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation. That means the handle is already claimed.
    if (error.code === "23505") return { ok: false, reason: "USERNAME_TAKEN", message: "That name is already taken. Try another one." };
    return { ok: false, reason: "SAVE_FAILED", message: "Cabi couldn't save your profile just now." };
  }
  const record = toRecord(data as Record<string, unknown> | null);
  if (!record) return { ok: false, reason: "SAVE_FAILED", message: "Cabi couldn't save your profile just now." };
  return { ok: true, profile: record };
}

/** Updates the avatar reference only. Used after an upload succeeds. */
export async function setAvatar(walletAccountId: string, avatarPath: string | null) {
  const db = getServiceClient();
  if (!db) return false;
  const { data, error } = await db
    .from("profiles")
    .update({ avatar_path: avatarPath, updated_at: new Date().toISOString() })
    .eq("wallet_account_id", walletAccountId)
    .select("wallet_account_id")
    .maybeSingle();
  return !error && Boolean(data);
}

/** Is this handle free? Advisory only - the unique index is the real guard. */
export async function isUsernameAvailable(candidate: string): Promise<boolean> {
  const validated = validateUsername(candidate);
  if (!validated.ok) return false;
  const db = getServiceClient();
  if (!db) return false;
  const { data } = await db.from("profiles").select("wallet_account_id").eq("username", validated.username).maybeSingle();
  return !data;
}

/**
 * Public projection for `/u/[username]`.
 *
 * Delegates to the `public_profile` database function, which applies the same
 * eligibility filter the leaderboard uses and reads the live monthly season.
 * Keeping the projection in SQL means the public page and the leaderboard cannot
 * disagree about someone's rank, and it is impossible to widen the page's field
 * list from the application by accident.
 *
 * Never includes a wallet address, a memory, a conversation, or an admin field.
 */
export async function readPublicProfile(username: string) {
  const db = getServiceClient();
  if (!db) return null;
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const { data, error } = await db.rpc("public_profile", { p_username: normalized });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row || !row.username) return null;

  return {
    username: String(row.username),
    initials: initialsFor(String(row.username)),
    avatarPath: (row.avatar_path as string | null) ?? null,
    tier: Number(row.rank_tier ?? 1),
    seasonXp: Number(row.season_xp ?? 0),
    seasonLabel: (row.season_label as string | null) ?? null,
    placement: row.placement == null ? null : Number(row.placement),
    lifetimeXp: Number(row.lifetime_xp ?? 0),
    bestRankTier: row.best_rank_tier == null ? null : Number(row.best_rank_tier),
    bestLeaderboardPosition: row.best_leaderboard_position == null ? null : Number(row.best_leaderboard_position),
    joinedAt: (row.joined_at as string | null) ?? null,
    // The bond badge is only published when the owner opted in.
    showBondPublicly: Boolean(row.show_bond_publicly),
    achievements: Array.isArray(row.achievements) ? (row.achievements as string[]).map(String) : [],
  };
}
