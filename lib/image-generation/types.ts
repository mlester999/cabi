/**
 * Image generation types.
 *
 * The provider is independent of DeepSeek chat: a chat outage must not disable
 * image generation, and an image provider outage must not break chat.
 */

export type AspectRatio = "1:1" | "16:9" | "9:16" | "3:2" | "2:3";

export const aspectRatios: readonly AspectRatio[] = ["1:1", "16:9", "9:16", "3:2", "2:3"] as const;

export const aspectRatioSizes: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "3:2": { width: 1216, height: 832 },
  "2:3": { width: 832, height: 1216 },
};

export type ImageProviderId = "openai" | "stability" | "replicate" | "custom";

export type ImageQuality = "standard" | "high";

export type ImageProviderConfig = {
  provider: ImageProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** True when the provider accepts a reference image for character consistency. */
  supportsReferenceImage: boolean;
};

export type GeneratedImage = {
  /** Raw bytes, ready to upload to storage. */
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  provider: ImageProviderId;
  model: string;
  width: number;
  height: number;
};

export type ImageGenerationError =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "UNSAFE_PROMPT";

export type ImageGenerationResult =
  | { ok: true; image: GeneratedImage }
  | { ok: false; error: ImageGenerationError; message: string };

export type ImageConnectionTest =
  | { ok: true; model: string; message: string }
  | { ok: false; error: ImageGenerationError; message: string };

export type ImageGenerationSettings = {
  enabled: boolean;
  provider: ImageProviderId;
  baseUrl: string;
  model: string;
  defaultAspectRatio: AspectRatio;
  defaultQuality: ImageQuality;
  dailyLimit: number;
  allowGuestGeneration: boolean;
  /** Whether an API key is stored. The key itself is never returned. */
  hasApiKey: boolean;
  keyLastFour: string | null;
};

export const defaultImageSettings: ImageGenerationSettings = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-image-1",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  hasApiKey: false,
  keyLastFour: null,
};