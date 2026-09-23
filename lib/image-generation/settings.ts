import "server-only";

import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { decryptSecret, encryptSecret, type SecretEnvelope } from "@/lib/security/crypto";
import { defaultImageSettings, type AspectRatio, type ImageGenerationSettings, type ImageProviderId, type ImageQuality } from "@/lib/image-generation/types";
import { z } from "zod";

/**
 * Image generation settings.
 *
 * Mirrors the DeepSeek settings architecture deliberately: the non-secret
 * configuration lives in `app_settings` and the API key lives in
 * `secret_settings` encrypted with AES-256-GCM under APP_ENCRYPTION_KEY, with a
 * record-bound AAD. The key is therefore:
 *
 * - never returned to a browser (only the last four characters are exposed),
 * - never written to a log,
 * - never held in client state.
 */

export const imageSettingsKey = "image_generation";
export const imageSecretKey = "image_generation_api_key";

export const imageSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["openai", "stability", "replicate", "custom"]),
  baseUrl: z.string().trim().max(2_000).refine((value) => !value || value.startsWith("https://"), "Use a complete HTTPS URL."),
  model: z.string().trim().max(120),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16", "3:2", "2:3"]),
  defaultQuality: z.enum(["standard", "high"]),
  dailyLimit: z.number().int().min(1).max(100),
  allowGuestGeneration: z.boolean(),
});

export type ImageSettingsInput = z.infer<typeof imageSettingsSchema>;

export function parseImageSettings(value: unknown): ImageSettingsInput {
  const parsed = imageSettingsSchema.partial().safeParse(value ?? {});
  return {
    enabled: parsed.success && parsed.data.enabled !== undefined ? parsed.data.enabled : defaultImageSettings.enabled,
    provider: (parsed.success && parsed.data.provider ? parsed.data.provider : defaultImageSettings.provider) as ImageProviderId,
    baseUrl: parsed.success && parsed.data.baseUrl !== undefined ? parsed.data.baseUrl : defaultImageSettings.baseUrl,
    model: parsed.success && parsed.data.model !== undefined ? parsed.data.model : defaultImageSettings.model,
    defaultAspectRatio: (parsed.success && parsed.data.defaultAspectRatio ? parsed.data.defaultAspectRatio : defaultImageSettings.defaultAspectRatio) as AspectRatio,
    defaultQuality: (parsed.success && parsed.data.defaultQuality ? parsed.data.defaultQuality : defaultImageSettings.defaultQuality) as ImageQuality,
    dailyLimit: parsed.success && parsed.data.dailyLimit !== undefined ? parsed.data.dailyLimit : defaultImageSettings.dailyLimit,
    allowGuestGeneration: parsed.success && parsed.data.allowGuestGeneration !== undefined
      ? parsed.data.allowGuestGeneration
      : defaultImageSettings.allowGuestGeneration,
  };
}

/** Settings for a client or an admin screen. Never includes the key itself. */
export async function readImageSettings(): Promise<ImageGenerationSettings> {
  const db = getServiceClient();
  if (!db) return defaultImageSettings;
  const [{ data: setting }, { data: secret }] = await Promise.all([
    db.from("app_settings").select("value_json").eq("key", imageSettingsKey).maybeSingle(),
    db.from("secret_settings").select("last_four").eq("key", imageSecretKey).maybeSingle(),
  ]);
  const parsed = parseImageSettings(setting?.value_json);
  return {
    ...parsed,
    hasApiKey: Boolean(secret?.last_four),
    keyLastFour: (secret?.last_four as string | null) ?? null,
  };
}

/**
 * The provider config, including the decrypted key.
 *
 * Server-only and never serialised into a response. Returns null when no key is
 * configured or the app encryption key is missing, which the route reports as
 * "not configured" rather than attempting a call.
 */
export async function readImageProviderConfig(): Promise<{ settings: ImageSettingsInput; apiKey: string } | null> {
  const db = getServiceClient();
  if (!db) return null;

  const [{ data: setting }, { data: secret }] = await Promise.all([
    db.from("app_settings").select("value_json").eq("key", imageSettingsKey).maybeSingle(),
    db.from("secret_settings").select("encrypted_value").eq("key", imageSecretKey).maybeSingle(),
  ]);
  const resolved = parseImageSettings(setting?.value_json);
  const encryptionKey = env("APP_ENCRYPTION_KEY");
  if (!secret?.encrypted_value || !encryptionKey) return null;

  try {
    const apiKey = await decryptSecret(secret.encrypted_value as SecretEnvelope, encryptionKey, `cabi:secret_settings:${imageSecretKey}:v1`);
    if (!apiKey) return null;
    return { settings: resolved, apiKey };
  } catch {
    // A key that cannot be decrypted is treated as absent rather than crashing a
    // request. This happens if APP_ENCRYPTION_KEY was rotated.
    return null;
  }
}

export async function writeImageSettings(input: ImageSettingsInput, actor: string, apiKey?: string) {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");

  const { error } = await db
    .from("app_settings")
    .upsert({ key: imageSettingsKey, value_json: input, updated_by: actor }, { onConflict: "key" });
  if (error) throw new Error("SAVE_FAILED");

  if (apiKey) {
    const encryptionKey = env("APP_ENCRYPTION_KEY");
    if (!encryptionKey) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
    // The AAD binds the ciphertext to this exact record, so a value moved
    // between rows fails to decrypt.
    const envelope = await encryptSecret(apiKey, encryptionKey, `cabi:secret_settings:${imageSecretKey}:v1`);
    const { error: secretError } = await db
      .from("secret_settings")
      .upsert({ key: imageSecretKey, encrypted_value: envelope, last_four: apiKey.slice(-4), updated_by: actor }, { onConflict: "key" });
    if (secretError) throw new Error("SECRET_SAVE_FAILED");
  }
}

export async function removeImageApiKey() {
  const db = getServiceClient();
  if (!db) return;
  await db.from("secret_settings").delete().eq("key", imageSecretKey);
}