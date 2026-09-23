import { clearMemories, listMemories } from "@/lib/memory/store";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function GET() {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  return Response.json({ memories: await listMemories(auth.identity.walletAccountId, 100) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  await clearMemories(auth.identity.walletAccountId);
  return new Response(null, { status: 204 });
}
