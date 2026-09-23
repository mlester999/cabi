import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { DEFAULT_CABI_PERSONALITY } from "@/lib/ai/prompts";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { z } from "zod";

const allowed = new Set(["personality", "branding", "cpu_config", "app_config"]);
const defaults: Record<string, unknown> = {
  personality: { systemPrompt: DEFAULT_CABI_PERSONALITY, greeting: "Hey. What should I call you?", traits: "warm, confident, curious, witty, playful", allowedNickname: "Cabi", tone: "casual", catExpressionFrequency: "low", defaultMood: "cozy", memoryBehavior: "Remember only useful details or explicit requests." },
  branding: { projectName: "Cabi", ticker: "CPU", tagline: "Cute, loyal, and always by your side.", primaryColor: "#C4B5FD", secondaryColor: "#8B5CF6", xUrl: "", clankUrl: "", websiteUrl: "", contractAddress: "", mainAsset: "/assets/cabi-main.png", mascotAsset: "/assets/cabi-mascot.png" },
  cpu_config: { coinName: "Cat Partner Unit", ticker: "CPU", contractAddress: "", clankUrl: "", xUrl: "", launchStatus: "Not configured", description: "", announcement: "" },
  app_config: { knowledgeSource: "https://clank.trade/", memoryExtraction: true, summaries: true, adminConversationAccess: false },
};
const bodySchema = z.record(z.string(), z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]));

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; const { key } = await params; if (!allowed.has(key)) return jsonError("Unknown setting.", 404, "NOT_FOUND");
  const db = getServiceClient(); if (!db) return Response.json({ value: defaults[key], databaseReady: false }, { headers: { "Cache-Control": "private, no-store" } });
  const { data } = await db.from("app_settings").select("value_json").eq("key", key).maybeSingle(); return Response.json({ value: data?.value_json ?? defaults[key], databaseReady: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response; try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const { key } = await params; if (!allowed.has(key)) return jsonError("Unknown setting.", 404, "NOT_FOUND"); const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Invalid settings.", 400, "INVALID_INPUT");
  const db = getServiceClient(); if (!db) return jsonError("Supabase must be connected first.", 503, "DATABASE_NOT_CONFIGURED"); const { error } = await db.from("app_settings").upsert({ key, value_json: parsed.data, updated_by: auth.session!.email }, { onConflict: "key" }); if (error) return jsonError("Couldn't save settings.", 503, "SAVE_FAILED");
  await auditAdmin(request, auth.session!.email, "config.update", "app_settings", key, "success", { fields: Object.keys(parsed.data) }); return Response.json({ ok: true });
}
