import { getServiceClient } from "@/lib/db/supabase";
import { jsonError } from "@/lib/security/request";
import { readGuestId } from "@/lib/security/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Session required.", 401, "SESSION_REQUIRED");
  const db = getServiceClient();
  if (!db) return Response.json({ conversations: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const search = new URL(request.url).searchParams.get("q")?.trim();
  let query = db.from("conversations").select("id,title,pinned,created_at,updated_at").eq("user_id", profileId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(60);
  if (search) query = query.ilike("title", `%${search.replaceAll(/[,%()]/gu, "")}%`);
  const { data, error } = await query;
  if (error) return jsonError("Cabi couldn't load your chats.", 503, "CONVERSATION_LOAD_FAILED");
  return Response.json({ conversations: data }, { headers: { "Cache-Control": "private, no-store" } });
}
