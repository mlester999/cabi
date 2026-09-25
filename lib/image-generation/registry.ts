import type { AspectRatio, ImageProviderCapabilities, ImageProviderId } from "@/lib/image-generation/types";

export type ImageProviderDefinition = {
  id: Extract<ImageProviderId, "together">;
  label: string;
  description: string;
  endpoint: string;
};

/**
 * Canonical provider registry.
 *
 * The id is the value persisted in settings and submitted by the admin form;
 * the label is presentation-only. Keep provider metadata here so the UI,
 * validation, persistence normalization, and adapters cannot drift apart.
 */
export const IMAGE_PROVIDERS = {
  together: {
    id: "together",
    label: "Together AI",
    description: "Verified image generation and reference conditioning for Cabi.",
    endpoint: "https://api.together.xyz/v1/images/generations",
  },
} as const satisfies Record<string, ImageProviderDefinition>;

export type CatalogImageProviderId = keyof typeof IMAGE_PROVIDERS;

export type ImageReferenceParameter = "image_url" | "reference_images";

export type ImageModelTier = "budget" | "standard" | "pro" | "specialized";

const supportedTogetherSizes = ["1:1", "16:9", "9:16"] as const satisfies readonly AspectRatio[];

/**
 * The image catalog is the single source of truth for the owner-facing model
 * picker and the server-side capability checks. Keep entries here only when the
 * current provider adapter has been verified against that model.
 */
export type ImageModelDefinition = {
  id: string;
  provider: CatalogImageProviderId;
  label: string;
  description: string;
  useCase: string;
  qualityNote?: string;
  badges: readonly string[];
  tier: ImageModelTier;
  supportedSizes: readonly AspectRatio[];
  supportsTextToImage: boolean;
  supportsReferenceImages: boolean;
  referenceParameter?: ImageReferenceParameter;
  supportsImageEditing: boolean;
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  supportsSteps: boolean;
  recommended?: boolean;
};

export const IMAGE_MODELS = {
  "Qwen/Qwen-Image-2.0": {
    id: "Qwen/Qwen-Image-2.0",
    provider: "together",
    label: "Qwen Image 2.0",
    description: "Best balance for Cabi generation and reference-image consistency.",
    useCase: "Best default balance for Cabi.",
    badges: ["Recommended", "Reference Ready", "Image Editing"],
    tier: "standard",
    supportedSizes: supportedTogetherSizes,
    supportsTextToImage: true,
    supportsReferenceImages: true,
    referenceParameter: "image_url",
    supportsImageEditing: true,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsSteps: true,
    recommended: true,
  },
  "Qwen/Qwen-Image-2.0-Pro": {
    id: "Qwen/Qwen-Image-2.0-Pro",
    provider: "together",
    label: "Qwen Image 2.0 Pro",
    description: "Use when you want maximum visual quality for a final generation.",
    qualityNote: "Highest quality · higher generation cost",
    useCase: "Higher-quality final Cabi generations.",
    badges: ["Highest Quality", "Reference Ready", "Image Editing"],
    tier: "pro",
    supportedSizes: supportedTogetherSizes,
    supportsTextToImage: true,
    supportsReferenceImages: true,
    referenceParameter: "image_url",
    supportsImageEditing: true,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsSteps: true,
  },
  "Qwen/Qwen-Image": {
    id: "Qwen/Qwen-Image",
    provider: "together",
    label: "Qwen Image",
    description: "Budget text-to-image model with Together's documented image_url reference input.",
    qualityNote: "Lower-cost option; Qwen Image 2.0 remains the recommended Cabi default.",
    useCase: "Lower-cost generations and reference edits where maximum character consistency is less important.",
    badges: ["Budget", "Text to Image", "Reference Ready", "Image Editing"],
    tier: "budget",
    supportedSizes: supportedTogetherSizes,
    supportsTextToImage: true,
    supportsReferenceImages: true,
    referenceParameter: "image_url",
    supportsImageEditing: true,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsSteps: true,
  },
  "black-forest-labs/FLUX.1-kontext-pro": {
    id: "black-forest-labs/FLUX.1-kontext-pro",
    provider: "together",
    label: "FLUX Kontext Pro",
    description: "Strong reference preservation for identity-led edits and scene changes.",
    useCase: "Strong Cabi identity and reference preservation.",
    badges: ["Character Consistency", "Reference Image", "Image Editing"],
    tier: "specialized",
    supportedSizes: supportedTogetherSizes,
    supportsTextToImage: true,
    supportsReferenceImages: true,
    referenceParameter: "image_url",
    supportsImageEditing: true,
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsSteps: true,
  },
} satisfies Record<string, ImageModelDefinition>;

export type ImageModelId = keyof typeof IMAGE_MODELS;

/** UI options are derived from the provider registry; labels are never stored. */
export const IMAGE_PROVIDER_OPTIONS = Object.values(IMAGE_PROVIDERS);

export type ImageProviderOption = (typeof IMAGE_PROVIDER_OPTIONS)[number];

export function imageProviderFor(provider: string): ImageProviderDefinition | null {
  return Object.values(IMAGE_PROVIDERS).find((candidate) => candidate.id === provider) ?? null;
}

export function imageModelsForProvider(provider: string): ImageModelDefinition[] {
  return Object.values(IMAGE_MODELS).filter((model) => model.provider === provider);
}

export function imageModelFor(provider: string, modelId: string): ImageModelDefinition | null {
  const model = Object.values(IMAGE_MODELS).find(
    (candidate) => candidate.provider === provider && candidate.id === modelId,
  );
  return model ?? null;
}

export function isSupportedImageProvider(value: string): value is ImageProviderOption["id"] {
  return imageProviderFor(value) !== null;
}

export function isImageModelForProvider(provider: string, modelId: string): boolean {
  return imageModelFor(provider, modelId) !== null;
}

export function recommendedImageModel(provider = "together"): ImageModelDefinition {
  return imageModelsForProvider(provider).find((model) => model.recommended)
    ?? imageModelsForProvider(provider)[0]
    ?? IMAGE_MODELS["Qwen/Qwen-Image-2.0"];
}

/**
 * Returns the capabilities for a provider/model pair without constructing a
 * provider or touching credentials. This is shared by settings resolution,
 * the admin surface, and runtime adapters so their reference decisions cannot
 * drift.
 */
export function imageCapabilitiesForModel(config: { provider: string; model?: string }): ImageProviderCapabilities {
  const model = imageModelFor(config.provider, config.model ?? "");
  if (!model) {
    return {
      supportsTextToImage: false,
      supportsReferenceImages: false,
      supportsImageToImage: false,
      supportsImageEditing: false,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsSteps: false,
    };
  }
  return {
    supportsTextToImage: model.supportsTextToImage,
    supportsReferenceImages: model.supportsReferenceImages,
    supportsImageToImage: model.supportsImageEditing,
    supportsImageEditing: model.supportsImageEditing,
    supportsSeed: model.supportsSeed,
    referenceParameter: model.referenceParameter,
    supportsNegativePrompt: model.supportsNegativePrompt,
    supportsSteps: model.supportsSteps,
  };
}
