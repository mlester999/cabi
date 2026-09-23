import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { bondFromPoints } from "@/lib/bond";

/**
 * The bond profile, plus the relationship stats Cabi can honestly show.
 *
 * Important: bond is derived ONLY from conversation activity that the database
 * already caps (one scored event per conversation per day). Nothing here looks at
 * token holdings, trade volume, wallet balance, or spend - the schema makes that
 * impossible, and this reader does not add such a path.
 *
 * Counts are read scoped to the authenticated wallet account, so this can never
 * surface another user's activity.
 */
export type BondProfile = {
  points: number;
  level: number;
  label: string;
  progress: number;
  pointsToNextLevel: number;
  /** Distinct days the user and Cabi actually talked. */
  conversationDays: number;
  conversationCount: number;
  memoryCount: number;
  firstSeenAt: string | null;
  lastInteractionAt: string | null;
};

export async function readBondProfile(walletAccountId: string, profileId: string): Promise<BondProfile> {
  const db = getServiceClient();
  if (!db) {
    return { ...bondFromPoints(0), pointsToNextLevel: 18, conversationDays: 0, conversationCount: 0, memoryCount: 0, firstSeenAt: null, lastInteractionAt: null };
  }

  const [bondRow, conversations, memories, profile] = await Promise.all([
    db.from("bond_profiles").select("bond_points,conversation_days,last_interaction_at").eq("wallet_account_id", walletAccountId).maybeSingle(),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("wallet_account_id", walletAccountId),
    db.from("user_memories").select("id", { count: "exact", head: true }).eq("wallet_account_id", walletAccountId),
    db.from("profiles").select("created_at").eq("id", profileId).maybeSingle(),
  ]);

  const rawPoints = Number(bondRow.data?.bond_points ?? 0);
  const bond = bondFromPoints(Number.isFinite(rawPoints) ? rawPoints : 0);
  const nextFloor = bond.level >= 10 ? bond.points : bond.level ** 2 * 18;

  return {
    ...bond,
    pointsToNextLevel: Math.max(0, nextFloor - bond.points),
    conversationDays: Number(bondRow.data?.conversation_days ?? 0),
    conversationCount: conversations.count ?? 0,
    memoryCount: memories.count ?? 0,
    firstSeenAt: profile.data?.created_at ?? null,
    lastInteractionAt: bondRow.data?.last_interaction_at ?? null,
  };
}