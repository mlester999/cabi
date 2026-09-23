import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { encryptSecret } from "@/lib/security/crypto";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { aiSettingsSchema } from "@/lib/validation/api";

export async function GET() {
  const auth = await adminOrResponse(); if (auth.response) return auth.response;
  const db = getServiceClient();
  const defaults = { provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "", wireApi: "chat-completions", temperature: 0.8, maxOutputTokens: 1200, timeoutMs: 60000, retryCount: 1, streaming: true };
  if (!db) return Response.json({ config: defaults, key: { configured: Boolean(env("DEEPSEEK_API_KEY")), source: env("DEEPSEEK_API_KEY") ? "environment" : null, masked: env("DEEPSEEK_API_KEY") ? `sk-••••••••••${env("DEEPSEEK_API_KEY")!.slice(-4)}` : null }, databaseReady: false }, { headers: { "Cache-Control": "private, no-store" } });
  const [{ data: setting }, { data: secret }] = await Promise.all([db.from("app_settings").select("value_json").eq("key", "ai_config").maybeSingle(), db.from("secret_settings").select("last_four,updated_at").eq("key", "deepseek_api_key").maybeSingle()]);
  const environmentKey = env("DEEPSEEK_API_KEY");
  return Response.json({ config: { ...defaults, ...(setting?.value_json as object ?? {}) }, key: { configured: Boolean(secret || environmentKey), source: secret ? "admin" : environmentKey ? "environment" : null, masked: secret ? `sk-••••••••••${secret.last_four}` : environmentKey ? `sk-••••••••••${environmentKey.slice(-4)}` : null, updatedAt: secret?.updated_at }, databaseReady: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const parsed = aiSettingsSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError("Check the AI settings and try again.", 400, "INVALID_INPUT");
  const db = getServiceClient(); if (!db) return jsonError("Supabase must be connected before admin settings can be saved.", 503, "DATABASE_NOT_CONFIGURED");
  const { apiKey, removeApiKey, ...config } = parsed.data;
  const { error: settingsError } = await db.from("app_settings").upsert({ key: "ai_config", value_json: config, updated_by: auth.session!.email }, { onConflict: "key" });
  if (settingsError) return jsonError("Couldn't save AI settings.", 503, "SAVE_FAILED");
  if (apiKey) {
    const encryptionKey = env("APP_ENCRYPTION_KEY"); if (!encryptionKey) return jsonError("APP_ENCRYPTION_KEY must be configured before saving an API key.", 503, "ENCRYPTION_NOT_CONFIGURED");
    const envelope = await encryptSecret(apiKey, encryptionKey, "cabi:secret_settings:deepseek_api_key:v1");
    const { error } = await db.from("secret_settings").upsert({ key: "deepseek_api_key", encrypted_value: envelope, last_four: apiKey.slice(-4), updated_by: auth.session!.email }, { onConflict: "key" });
    if (error) return jsonError("Couldn't save the encrypted API key.", 503, "SECRET_SAVE_FAILED");
  } else if (removeApiKey) await db.from("secret_settings").delete().eq("key", "deepseek_api_key");
  await auditAdmin(request, auth.session!.email, "ai.config.update", "app_settings", "ai_config", "success", { fields: Object.keys(config), keyAction: apiKey ? "replaced" : removeApiKey ? "removed" : "unchanged" });
  return Response.json({ ok: true });
}
