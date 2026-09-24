import "server-only";

import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { decryptSecret, encryptSecret, type SecretEnvelope } from "@/lib/security/crypto";
import { togetherImageEndpoint } from "@/lib/ai/image/together";
import { imageModelFor, recommendedImageModel } from "@/lib/image-generation/registry";
import {
  defaultImageSettings,
  type AspectRatio,
  type ImageGenerationSettings,
  type ImageProviderId,
  type ImageQuality,
} from "@/lib/image-generation/types";
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
 * - never held in client state after a save.
 */

export const imageSettingsKey = "image_generation";
export const imageSecretKey = "image_generation_api_key";

/**
 * This schema still understands legacy provider ids so existing installations
 * can be read safely. The admin route uses the stricter registry-backed schema
 * and exposes Together AI only.
 */
export const imageSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["together", "openai", "stability", "replicate", "custom"]),
  baseUrl: z.string().trim().max(2_000).refine((value) => !value || value.startsWith("https://"), "Use a complete HTTPS URL."),
  model: z.string().trim().max(120),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16"]),
  defaultQuality: z.enum(["standard", "high"]),
  dailyLimit: z.number().int().min(1).max(100),
  allowGuestGeneration: z.boolean(),
});

export type ImageSettingsInput = z.infer<typeof imageSettingsSchema>;

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Detects the shipped pre-Together defaults only. */
export function isLegacyImageSettings(value: unknown): boolean {
  const raw = recordFrom(value);
  const provider = typeof raw.provider === "string" ? raw.provider.trim().toLowerCase() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";

  if (provider === "openai-compatible") return true;
  if (provider !== "openai") return false;
  // A deliberately configured OpenAI adapter may still use the official
  // OpenAI host. Only the shipped blank/gpt-image-1 defaults are migrated.
  return !model || model === "gpt-image-1";
}

/** True when the persisted Together record needs a safe canonical rewrite. */
export function needsImageSettingsNormalization(value: unknown): boolean {
  const raw = recordFrom(value);
  const provider = typeof raw.provider === "string" ? raw.provider.trim().toLowerCase() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";

  if (isLegacyImageSettings(value)) return true;
  if (provider !== "together") return false;
  return imageModelFor("together", model) === null || baseUrl !== togetherImageEndpoint;
}

/** The provider named by IMAGE_PROVIDER, when it is one we support at runtime. */
export function providerFromEnvironment(): ImageProviderId | null {
  const value = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  if (!value || value === "openai-compatible") return null;
  return imageSettingsSchema.shape.provider.safeParse(value).success ? (value as ImageProviderId) : null;
}

/** The recognized Together model named by TOGETHER_IMAGE_MODEL, when set. */
export function modelFromEnvironment(): string | null {
  const value = process.env.TOGETHER_IMAGE_MODEL?.trim();
  return value && imageModelFor("together", value) ? value : null;
}

export function parseImageSettings(value: unknown): ImageSettingsInput {
  const parsed = imageSettingsSchema.partial().safeParse(value ?? {});
  const data = parsed.success ? parsed.data : {};
  let provider = (data.provider ?? providerFromEnvironment() ?? defaultImageSettings.provider) as ImageProviderId;
  let model = data.model && data.model.length > 0 ? data.model : modelFromEnvironment() ?? defaultImageSettings.model;
  let baseUrl = data.baseUrl ?? defaultImageSettings.baseUrl;

  // Known stale defaults and unknown Together models are normalized to the
  // recommended catalog entry. Other intentionally configured adapters are
  // preserved for runtime compatibility and are never surfaced as Together.
  if (isLegacyImageSettings(value) || (provider === "together" && !imageModelFor("together", model))) {
    provider = "together";
    model = recommendedImageModel("together").id;
    baseUrl = togetherImageEndpoint;
  } else if (provider === "together") {
    // Together owns its endpoint. A persisted or browser-supplied base URL can
    // never change where the Together adapter sends credentials.
    model = imageModelFor("together", model)?.id ?? recommendedImageModel("together").id;
    baseUrl = togetherImageEndpoint;
  }

  return {
    enabled: data.enabled !== undefined ? data.enabled : defaultImageSettings.enabled,
    provider,
    baseUrl,
    model,
    defaultAspectRatio: (data.defaultAspectRatio ?? defaultImageSettings.defaultAspectRatio) as AspectRatio,
    defaultQuality: (data.defaultQuality ?? defaultImageSettings.defaultQuality) as ImageQuality,
    dailyLimit: data.dailyLimit !== undefined ? data.dailyLimit : defaultImageSettings.dailyLimit,
    allowGuestGeneration: data.allowGuestGeneration !== undefined
      ? data.allowGuestGeneration
      : defaultImageSettings.allowGuestGeneration,
  };
}

/** Settings for a client or an admin screen. Never includes the key itself. */
export async function readImageSettings(): Promise<ImageGenerationSettings> {
  const db = getServiceClient();
  if (!db) return { ...defaultImageSettings };
  const [{ data: setting }, { data: secret }] = await Promise.all([
    db.from("app_settings").select("value_json").eq("key", imageSettingsKey).maybeSingle(),
    db.from("secret_settings").select("last_four").eq("key", imageSecretKey).maybeSingle(),
  ]);
  const parsed = parseImageSettings(setting?.value_json);

  // Migrate only stale defaults or invalid Together model/endpoint pairs. A
  // deliberately configured legacy provider does not get overwritten here.
  if (setting?.value_json && needsImageSettingsNormalization(setting.value_json)) {
    await db.from("app_settings").upsert({
      key: imageSettingsKey,
      value_json: parsed,
      updated_by: "system:image-settings-migration",
    }, { onConflict: "key" });
  }

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

  const normalized = parseImageSettings(input);
  const { error } = await db
    .from("app_settings")
    .upsert({ key: imageSettingsKey, value_json: normalized, updated_by: actor }, { onConflict: "key" });
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
