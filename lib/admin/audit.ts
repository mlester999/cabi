import "server-only";
import { getServiceClient } from "@/lib/db/supabase";
import { hashValue } from "@/lib/security/crypto";

export async function auditAdmin(request: Request, actor: string, action: string, targetType: string, targetId: string | null, outcome: "success" | "failure", metadata: Record<string, unknown> = {}) {
  const db = getServiceClient(); if (!db) return;
  const rawIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";
  await db.from("audit_logs").insert({ actor_type: "admin", actor_id: actor, action, target_type: targetType, target_id: targetId, outcome, ip_hash: await hashValue(rawIp), user_agent_hash: await hashValue(ua), request_id: request.headers.get("cf-ray") ?? crypto.randomUUID(), metadata_json: metadata });
}
