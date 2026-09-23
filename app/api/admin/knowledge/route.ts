import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";

export async function GET() {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; const db = getServiceClient(); if (!db) return Response.json({ databaseReady: false, status: null, documents: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const [{ data: status }, { data: documents, count }] = await Promise.all([db.from("knowledge_sync_runs").select("id,status,source,pages_indexed,chunks_indexed,errors_json,created_at,completed_at").order("created_at", { ascending: false }).limit(1).maybeSingle(), db.from("knowledge_documents").select("id,title,canonical_url,fetched_at,status", { count: "exact" }).order("fetched_at", { ascending: false }).limit(25)]);
  return Response.json({ databaseReady: true, status, documents: documents ?? [], pagesIndexed: count ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
