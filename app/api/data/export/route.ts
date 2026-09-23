import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export async function GET() {
  const blocked = await guardAppApi(); if (blocked) return blocked;
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response;
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const [profileResult, conversationsResult, memoriesResult, settingsResult] = await Promise.all([
    db.from("profiles").select("display_name,preferred_name,created_at,updated_at").eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle(),
    db.from("conversations").select("id,title,pinned,created_at,updated_at,messages(id,role,content,status,created_at,metadata_json)").eq("wallet_account_id", auth.identity.walletAccountId).order("created_at"),
    db.from("user_memories").select("id,category,content,importance,created_at,updated_at").eq("wallet_account_id", auth.identity.walletAccountId).order("created_at"),
    db.from("user_settings").select("memory_enabled,sound_enabled,animation_mode,appearance").eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle(),
  ]);
  if (profileResult.error || conversationsResult.error || memoriesResult.error || settingsResult.error) {
    return jsonError("Cabi couldn't prepare a complete export.", 503, "EXPORT_FAILED");
  }
  const { data: profile } = profileResult;
  const { data: conversations } = conversationsResult;
  const { data: memories } = memoriesResult;
  const { data: settings } = settingsResult;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile, settings, conversations: conversations ?? [], memories: memories ?? [] }, null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="cabi-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "private, no-store" } });
}
