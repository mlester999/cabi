/**
 * Image generation types.
 *
 * The provider is independent of DeepSeek chat: a chat outage must not disable
 * image generation, and an image provider outage must not break chat.
 */

/**
 * The three supported ratios.
 *
 * Deliberately a closed set: an open width/height pair would let a caller ask
 * for an extreme resolution, which costs more per generation. `3:2` and `2:3`
 * were dropped because they have no equivalent in the current model's supported
 * sizes.
 */
export type AspectRatio = "1:1" | "16:9" | "9:16";

export const aspectRatios: readonly AspectRatio[] = ["1:1", "16:9", "9:16"] as const;

export const aspectRatioSizes: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
};

export type ImageProviderId = "together" | "openai" | "stability" | "replicate" | "custom";

export type ImageQuality = "standard" | "high";

/**
 * What a provider or model can actually do.
 *
 * Deliberately a capability record rather than a boolean: "supports reference
 * images" and "supports image-to-image" are different features, and a model can
 * have one without the other. The admin console shows these values verbatim so an
 * owner is never told consistency is guaranteed by a model that cannot condition
 * on an image at all.
 */
export type ImageProviderCapabilities = {
  /** Accepts a reference image alongside the prompt. */
  supportsReferenceImages: boolean;
  /** Accepts an input image to edit rather than only a text prompt. */
  supportsImageToImage: boolean;
  /** Registry-facing name for image editing support. */
  supportsImageEditing?: boolean;
  /** Accepts a seed for reproducible output. */
  supportsSeed: boolean;
};

export const noImageCapabilities: ImageProviderCapabilities = {
  supportsReferenceImages: false,
  supportsImageToImage: false,
  supportsImageEditing: false,
  supportsSeed: false,
};

export type ImageProviderConfig = {
  provider: ImageProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** True when the provider accepts a reference image for character consistency. */
  supportsReferenceImage: boolean;
  /** Full capability record, when the caller knows it. */
  capabilities?: ImageProviderCapabilities;
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
  | {
      ok: true;
      model: string;
      message: string;
      capabilities?: ImageProviderCapabilities;
      referenceConditioning?: boolean;
    }
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
  provider: "together",
  baseUrl: "https://api.together.xyz/v1/images/generations",
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  hasApiKey: false,
  keyLastFour: null,
};
