import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";

export async function GET() {
  const auth = await adminOrResponse(); if (auth.response) return auth.response;
  const db = getServiceClient();
  if (!db) return Response.json({ configured: false, stats: { conversations: 0, messagesToday: 0, activeUsers: 0, newUsers: 0, aiRequests: 0, aiFailures: 0, averageLatency: 0, knowledgeStatus: "Not connected", lastSync: null } }, { headers: { "Cache-Control": "private, no-store" } });
  const today = new Date(); today.setHours(0, 0, 0, 0); const since = today.toISOString();
  const [conversations, messages, users, newUsers, requests, failures, latency, sync] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }), db.from("messages").select("id", { count: "exact", head: true }).gte("created_at", since), db.from("profiles").select("id", { count: "exact", head: true }).gte("updated_at", new Date(Date.now() - 86_400_000).toISOString()), db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since), db.from("usage_logs").select("id", { count: "exact", head: true }).gte("created_at", since), db.from("usage_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since), db.from("usage_logs").select("latency_ms").gte("created_at", since).limit(1000), db.from("knowledge_sync_runs").select("status,completed_at,pages_indexed,chunks_indexed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latencies = (latency.data ?? []).map((row) => Number(row.latency_ms)).filter(Number.isFinite);
  return Response.json({ configured: true, stats: { conversations: conversations.count ?? 0, messagesToday: messages.count ?? 0, activeUsers: users.count ?? 0, newUsers: newUsers.count ?? 0, aiRequests: requests.count ?? 0, aiFailures: failures.count ?? 0, averageLatency: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0, knowledgeStatus: sync.data?.status ?? "Never synced", lastSync: sync.data?.completed_at ?? null, pagesIndexed: sync.data?.pages_indexed ?? 0, chunksIndexed: sync.data?.chunks_indexed ?? 0 } }, { headers: { "Cache-Control": "private, no-store" } });
}
