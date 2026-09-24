import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { id } = await params;
  const { data, error } = await db.from("user_memories").delete().eq("id", id).eq("wallet_account_id", auth.identity.walletAccountId).select("id").maybeSingle();
  if (error) return jsonError("Couldn't forget that.", 503, "DELETE_FAILED");
  if (!data) return jsonError("Memory not found.", 404, "NOT_FOUND");
  return new Response(null, { status: 204 });
}
