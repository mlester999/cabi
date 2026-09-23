import { clearMemories, listMemories } from "@/lib/memory/store";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";

export async function GET() {
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  return Response.json({ memories: await listMemories(profileId, 100) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  await clearMemories(profileId);
  return new Response(null, { status: 204 });
}
