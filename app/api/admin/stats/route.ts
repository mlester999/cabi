import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";

export async function GET() {
  const auth = await adminOrResponse(); if (auth.response) return auth.response;
  const db = getServiceClient();
  if (!db) return Response.json({ error: "Supabase is not connected." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const today = new Date(); today.setHours(0, 0, 0, 0); const since = today.toISOString();
  const activityStart = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 11 * 3_600_000;
  const activitySince = new Date(activityStart).toISOString();
  const [conversations, messages, users, newUsers, requests, failures, usageSummary, contestEntries, sync] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }),
    db.from("messages").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("updated_at", new Date(Date.now() - 86_400_000).toISOString()),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("usage_logs").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("usage_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    db.rpc("admin_dashboard_usage_summary", { p_day_start: since, p_activity_start: activitySince, p_hours: 12 }),
    db.from("cabi_image_contest_entries").select("id", { count: "exact", head: true }),
    db.from("knowledge_sync_runs").select("status,completed_at,pages_indexed,chunks_indexed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const results = [conversations, messages, users, newUsers, requests, failures, usageSummary, contestEntries, sync];
  if (results.some((result) => result.error)) return Response.json({ error: "Live dashboard data is unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const summary = usageSummary.data?.[0];
  if (!summary) return Response.json({ error: "Live dashboard data is unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const activitySeries = Array.isArray(summary.activity_series) ? summary.activity_series.map(Number) : Array.from({ length: 12 }, () => 0);
  return Response.json({ stats: {
    conversations: conversations.count ?? 0,
    messagesToday: messages.count ?? 0,
    activeUsers: users.count ?? 0,
    newUsers: newUsers.count ?? 0,
    aiRequests: requests.count ?? 0,
    aiFailures: failures.count ?? 0,
    averageLatency: summary.average_latency_ms == null ? null : Math.round(Number(summary.average_latency_ms)),
    activitySeries,
    contestEntries: contestEntries.count ?? 0,
    knowledgeStatus: sync.data?.status ?? "Never synced",
    lastSync: sync.data?.completed_at ?? null,
    pagesIndexed: sync.data?.pages_indexed ?? 0,
    chunksIndexed: sync.data?.chunks_indexed ?? 0,
  } }, { headers: { "Cache-Control": "private, no-store" } });
}
