import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function DELETE(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response;
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { error } = await db.rpc("clear_user_data", { p_wallet_account_id: auth.identity.walletAccountId });
  if (error) return jsonError("Couldn't clear your data.", 503, "CLEAR_FAILED");
  return new Response(null, { status: 204 });
}
