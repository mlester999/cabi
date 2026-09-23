/**
 * Username rules.
 *
 * One handle, used everywhere: the leaderboard, the public profile, and the chat
 * header. Keeping a single unique identifier avoids the "which name do I show?"
 * ambiguity of separate display name and username fields, and it means the
 * leaderboard can never fall back to showing a wallet address.
 *
 * Stored lowercase. The database has a case-insensitive unique index plus a
 * shape CHECK constraint, so this module and the schema enforce the same rule.
 */

export const usernameRules = {
  minLength: 3,
  maxLength: 20,
  /** Lowercase letters, digits, underscore and hyphen. */
  pattern: /^[a-z0-9][a-z0-9_-]{2,19}$/u,
} as const;

export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; reason: "TOO_SHORT" | "TOO_LONG" | "INVALID_CHARACTERS" | "RESERVED" | "EMPTY"; message: string };

/**
 * Names that must not be claimable: they would let an account impersonate the
 * product, the owner, or the support surface.
 */
export const reservedUsernames: readonly string[] = [
  "cabi", "admin", "administrator", "root", "owner", "support", "help", "official",
  "cpu", "clanktrade", "clank", "moderator", "mod", "staff", "team", "system",
  "api", "www", "null", "undefined", "everyone", "settings",
] as const;

export function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    // Collapse internal whitespace to a single hyphen so "Mark Lester" becomes
    // "mark-lester" rather than being rejected outright.
    .replace(/\s+/gu, "-")
    .replace(/-{2,}/gu, "-");
}

export function validateUsername(value: unknown): UsernameValidation {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, reason: "EMPTY", message: "Pick a name so people know who you are." };

  // Reserved names are checked before the length and shape rules so the user is
  // told the real reason. Every reserved entry is at least the minimum length,
  // so this can only ever replace a less specific message.
  if (reservedUsernames.includes(username)) {
    return { ok: false, reason: "RESERVED", message: "That name is reserved. Try another one." };
  }
  if (username.length < usernameRules.minLength) {
    return { ok: false, reason: "TOO_SHORT", message: `That is a bit short. Use at least ${usernameRules.minLength} characters.` };
  }
  if (username.length > usernameRules.maxLength) {
    return { ok: false, reason: "TOO_LONG", message: `That is a bit long. Keep it to ${usernameRules.maxLength} characters.` };
  }
  if (!usernameRules.pattern.test(username)) {
    return { ok: false, reason: "INVALID_CHARACTERS", message: "Use letters, numbers, hyphens and underscores. Start with a letter or number." };
  }
  return { ok: true, username };
}

/**
 * Initials for the avatar fallback.
 *
 * Rendered in CSS from the handle, so an account without a photo never needs a
 * generated image file.
 */
export function initialsFor(username: string, max = 2): string {
  const cleaned = normalizeUsername(username);
  if (!cleaned) return "?";
  const parts = cleaned.split(/[-_]/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, max);
  return cleaned.slice(0, max).toUpperCase();
}