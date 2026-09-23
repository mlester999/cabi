import "server-only";
import { getServiceClient } from "@/lib/db/supabase";

const levels = ["Stranger", "New Friend", "Familiar", "Buddy", "Trusted Human", "Favorite Human", "Close Companion", "Partner", "Best Partner", "Forever CPU"];

export function bondFromPoints(points: number) {
  const safe = Math.max(0, points);
  const level = Math.min(10, Math.floor(Math.sqrt(safe / 18)) + 1);
  const currentFloor = (level - 1) ** 2 * 18;
  const nextFloor = level ** 2 * 18;
  const progress = level === 10 ? 100 : Math.round(((safe - currentFloor) / (nextFloor - currentFloor)) * 100);
  return { level, label: levels[level - 1], progress: Math.max(0, Math.min(100, progress)), points: safe };
}

export async function recordConversationBond(walletAccountId: string, conversationId: string) {
  const db = getServiceClient();
  if (!db) return bondFromPoints(0);
  const { data } = await db.rpc("record_bond_event", { p_wallet_account_id: walletAccountId, p_conversation_id: conversationId, p_event_type: "conversation_turn" });
  return bondFromPoints(Number(data ?? 0));
}
