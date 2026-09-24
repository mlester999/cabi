import { IMAGE_PROVIDERS } from "@/lib/image-generation/registry";

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
  /** Accepts a text prompt as the generation source. */
  supportsTextToImage?: boolean;
  /** Accepts a reference image alongside the prompt. */
  supportsReferenceImages: boolean;
  /** Accepts an input image to edit rather than only a text prompt. */
  supportsImageToImage: boolean;
  /** Registry-facing name for image editing support. */
  supportsImageEditing?: boolean;
  /** The Together wire field used for an accepted reference image. */
  referenceParameter?: "image_url" | "reference_images";
  /** Accepts a seed for reproducible output. */
  supportsSeed: boolean;
  /** Accepts a negative prompt. */
  supportsNegativePrompt?: boolean;
  /** Accepts an explicit inference-step count. */
  supportsSteps?: boolean;
};

export const noImageCapabilities: ImageProviderCapabilities = {
  supportsTextToImage: false,
  supportsReferenceImages: false,
  supportsImageToImage: false,
  supportsImageEditing: false,
  supportsSeed: false,
  supportsNegativePrompt: false,
  supportsSteps: false,
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

/** Safe, provider-agnostic category used only for server diagnostics. */
export type ImageProviderErrorCategory =
  | "none"
  | "authentication"
  | "billing"
  | "rate_limit"
  | "reference_input"
  | "model_or_endpoint"
  | "unsafe_prompt"
  | "third_party_data_sharing_required"
  | "model_access_restricted"
  | "organization_permission"
  | "invalid_project"
  | "other_provider_permission"
  | "provider_outage"
  | "timeout"
  | "provider_error";

export type ImageGenerationResult =
  | { ok: true; image: GeneratedImage }
  | {
      ok: false;
      error: ImageGenerationError;
      message: string;
      /** Provider status is server-side metadata; never expose it in chat copy. */
      httpStatus?: number;
      providerErrorCategory?: ImageProviderErrorCategory;
    };

export type ImageConnectionDiagnostics = {
  provider: string;
  /** Canonical values used by server-side validation, separate from labels. */
  providerReceived?: string;
  providerValid?: boolean;
  modelReceived?: string;
  modelValid?: boolean;
  /** True only when the decrypted admin key was the selected source. */
  storedKeyPresent?: boolean;
  /** True once the provider fetch was actually started. */
  providerRequestStarted?: boolean;
  endpoint: string;
  keyLoaded: boolean;
  keySuffix: string | null;
  httpStatus: number | null;
};

export type ImageConnectionTest =
  | {
      ok: true;
      model: string;
      message: string;
      capabilities?: ImageProviderCapabilities;
      referenceConditioning?: boolean;
      diagnostics?: ImageConnectionDiagnostics;
    }
  | { ok: false; error: ImageGenerationError; message: string; diagnostics?: ImageConnectionDiagnostics; providerErrorCategory?: ImageProviderErrorCategory };

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
  /** Safe metadata describing where the configured key came from. */
  apiKeySource?: "admin" | "environment" | null;
};

export const defaultImageSettings: ImageGenerationSettings = {
  enabled: true,
  provider: "together",
  baseUrl: IMAGE_PROVIDERS.together.endpoint,
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  hasApiKey: false,
  keyLastFour: null,
  apiKeySource: null,
};
