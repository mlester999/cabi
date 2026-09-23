import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";

export async function GET() {
  const profileId = await readGuestId(); if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const [{ data: profile }, { data: conversations }, { data: memories }, { data: settings }] = await Promise.all([
    db.from("profiles").select("display_name,preferred_name,created_at,updated_at").eq("id", profileId).maybeSingle(),
    db.from("conversations").select("id,title,pinned,created_at,updated_at,messages(id,role,content,status,created_at,metadata_json)").eq("user_id", profileId).order("created_at"),
    db.from("user_memories").select("id,category,content,importance,created_at,updated_at").eq("user_id", profileId).order("created_at"),
    db.from("user_settings").select("memory_enabled,sound_enabled,animation_mode,appearance").eq("user_id", profileId).maybeSingle(),
  ]);
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile, settings, conversations: conversations ?? [], memories: memories ?? [] }, null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="cabi-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "private, no-store" } });
}
