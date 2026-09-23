import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";

const resources = {
  users: { table: "profiles", fields: "wallet_account_id,username,display_name,ranking_status,lifetime_xp,created_at", order: "created_at" },
  conversations: { table: "conversations", fields: "id,wallet_account_id,title,pinned,created_at,updated_at", order: "updated_at" },
  memories: { table: "user_memories", fields: "id,wallet_account_id,category,content,importance,storage_reason,created_at,updated_at", order: "updated_at" },
  audit: { table: "audit_logs", fields: "id,occurred_at,actor_type,actor_id,action,target_type,target_id,outcome,metadata_json", order: "occurred_at" },
  // Deliberately not `as const`: literal types here make the generated Supabase
  // select signature too complex for TypeScript to represent.
} satisfies Record<string, { table: string; fields: string; order: string }>;

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; const { resource } = await params; if (!(resource in resources)) return jsonError("Unknown resource.", 404, "NOT_FOUND");
  const db = getServiceClient(); if (!db) return Response.json({ rows: [], count: 0, databaseReady: false }, { headers: { "Cache-Control": "private, no-store" } });
  const definition = resources[resource as keyof typeof resources]; const page = Math.max(0, Number(new URL(request.url).searchParams.get("page") ?? 0)); const from = page * 50;
  const { data, count, error } = await db.from(definition.table).select(definition.fields, { count: "exact" }).order(definition.order, { ascending: false }).range(from, from + 49);
  if (error) return jsonError("Couldn't load admin data.", 503, "LOAD_FAILED");
  await auditAdmin(request, auth.session!.email, `admin.${resource}.list`, resource, null, "success", { page });
  return Response.json({ rows: data ?? [], count: count ?? 0, databaseReady: true }, { headers: { "Cache-Control": "private, no-store" } });
}
