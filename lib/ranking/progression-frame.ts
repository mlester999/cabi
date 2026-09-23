import { tierByNumber, type RankTier } from "@/lib/ranking/tiers";

/**
 * Progression signals carried by the final `done` frame of a chat reply.
 *
 * Extracted from the chat component so the trigger rule is testable in
 * isolation. The decision itself is always server-side: this module only decides
 * how to present what the server already determined.
 */

export type ProgressionFrame = {
  /** Present only when this turn crossed a tier threshold. */
  rankUp?: { tier: number };
  /** Achievement labels earned by this turn, already humanised by the server. */
  achievements?: string[];
};

export type Celebration = { tier: RankTier; achievements: string[] };

/**
 * Returns the celebration to show, or null.
 *
 * Only a rank-up opens the celebration. An achievement on its own is listed on
 * the profile rather than interrupting the conversation, and — importantly — an
 * achievement arriving *with* a rank-up must never suppress the celebration.
 */
export function celebrationFor(frame: ProgressionFrame): Celebration | null {
  if (!frame.rankUp) return null;
  return {
    tier: tierByNumber(frame.rankUp.tier),
    achievements: frame.achievements ?? [],
  };
}