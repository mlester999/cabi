import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { crawlClankTrade } from "@/lib/knowledge/crawler";
import { assertSameOrigin, jsonError } from "@/lib/security/request";

export async function DELETE(request: Request) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const db = getServiceClient();
  if (!db) return jsonError("Supabase isn't connected.", 503, "DATABASE_NOT_CONFIGURED");
  const { error } = await db.from("knowledge_documents").delete().not("id", "is", null);
  if (error) return jsonError("Couldn't clear the knowledge base.", 503, "CLEAR_FAILED");
  try {
    const result = await crawlClankTrade();
    await auditAdmin(request, auth.session!.email, "knowledge.clear_rebuild", "knowledge", null, "success", result);
    return Response.json(result);
  } catch {
    await auditAdmin(request, auth.session!.email, "knowledge.clear_rebuild", "knowledge", null, "failure");
    return jsonError("The index was cleared, but the rebuild failed. Run Sync now to retry.", 503, "REBUILD_FAILED");
  }
}
