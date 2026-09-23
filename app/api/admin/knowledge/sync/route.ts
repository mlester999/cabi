import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { crawlClankTrade } from "@/lib/knowledge/crawler";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const limited = await checkRateLimit("admin.knowledge.sync", auth.session!.email, 2, 60 * 60); if (!limited.allowed) return jsonError("A sync ran recently. Try again later.", 429, "RATE_LIMITED");
  try { const result = await crawlClankTrade({ signal: request.signal }); await auditAdmin(request, auth.session!.email, "knowledge.sync", "knowledge", result.runId, result.status === "complete" ? "success" : "failure", { pagesIndexed: result.pagesIndexed, chunksIndexed: result.chunksIndexed, errorCount: result.errors.length }); return Response.json(result); }
  catch { await auditAdmin(request, auth.session!.email, "knowledge.sync", "knowledge", null, "failure"); return jsonError("Knowledge sync failed. Check the source and try again.", 502, "SYNC_FAILED"); }
}
