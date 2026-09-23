import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { guestChatImportSchema } from "@/lib/validation/api";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function POST(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try {
    assertSameOrigin(request);
  } catch {
    return jsonError("Invalid request.", 403, "INVALID_ORIGIN");
  }

  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const parsed = guestChatImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("That temporary chat can't be saved.", 400, "INVALID_GUEST_CHAT");

  const firstUserMessage = parsed.data.messages.find((message) => message.role === "user")?.content;
  const title = parsed.data.title ?? firstUserMessage?.replace(/\s+/gu, " ").slice(0, 54) ?? "New chat";
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { data, error } = await db.rpc("import_guest_conversation", {
    p_wallet_account_id: auth.identity.walletAccountId,
    p_title: title,
    p_messages: parsed.data.messages,
  }).single();
  if (error || !data) return jsonError("Cabi couldn't save that temporary chat.", 503, "GUEST_CHAT_IMPORT_FAILED");
  return Response.json({ conversation: data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
