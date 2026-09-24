import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { z } from "zod";

const schema = z.object({ memory_enabled: z.boolean().optional(), sound_enabled: z.boolean().optional(), animation_mode: z.enum(["full", "reduced"]).optional(), appearance: z.enum(["dark", "oled"]).optional() }).refine((value) => Object.keys(value).length > 0);

export async function GET() {
  const blocked = await guardAppApiCpu(); if (blocked) return blocked;
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { data, error } = await db.from("user_settings").select("memory_enabled,sound_enabled,animation_mode,appearance").eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle();
  if (error) return jsonError("Cabi couldn't load your settings.", 503, "SETTINGS_LOAD_FAILED");
  return Response.json({ settings: data ?? { memory_enabled: true, sound_enabled: false, animation_mode: "full", appearance: "dark" } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const blocked = await guardAppApiCpu(); if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse(); if (!auth.identity) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Invalid settings.", 400, "INVALID_INPUT");
  const db = getServiceClient(); if (!db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { data, error } = await db.from("user_settings").upsert({ wallet_account_id: auth.identity.walletAccountId, ...parsed.data }, { onConflict: "wallet_account_id" }).select("memory_enabled,sound_enabled,animation_mode,appearance").single();
  if (error) return jsonError("Couldn't save settings.", 503, "SAVE_FAILED");
  return Response.json({ settings: data });
}
