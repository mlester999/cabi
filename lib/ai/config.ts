import "server-only";
import type { ProviderConfig } from "@/lib/ai/provider";
import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { decryptSecret, type SecretEnvelope } from "@/lib/security/crypto";

type StoredAiConfig = Partial<Omit<ProviderConfig, "apiKey">> & { streaming?: boolean };

export async function getProviderConfig(): Promise<ProviderConfig | null> {
  let stored: StoredAiConfig = {};
  let storedKey: string | undefined;
  const db = getServiceClient();
  if (db) {
    const [{ data: setting }, { data: secret }] = await Promise.all([
      db.from("app_settings").select("value_json").eq("key", "ai_config").maybeSingle(),
      db.from("secret_settings").select("encrypted_value").eq("key", "deepseek_api_key").maybeSingle(),
    ]);
    stored = (setting?.value_json as StoredAiConfig | null) ?? {};
    const encryptionKey = env("APP_ENCRYPTION_KEY");
    if (secret?.encrypted_value && encryptionKey) storedKey = await decryptSecret(secret.encrypted_value as SecretEnvelope, encryptionKey, "cabi:secret_settings:deepseek_api_key:v1");
  }
  const apiKey = storedKey ?? env("DEEPSEEK_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: stored.baseUrl ?? env("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
    model: stored.model ?? env("DEEPSEEK_MODEL"),
    wireApi: stored.wireApi === "responses" ? "responses" : "chat-completions",
    temperature: Number(stored.temperature ?? env("DEEPSEEK_TEMPERATURE") ?? 0.8),
    maxOutputTokens: Number(stored.maxOutputTokens ?? env("DEEPSEEK_MAX_TOKENS") ?? 1200),
    timeoutMs: Number(stored.timeoutMs ?? env("DEEPSEEK_TIMEOUT_MS") ?? 60_000),
    retryCount: Number(stored.retryCount ?? 1),
  };
}
