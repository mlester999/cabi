import type { ImageProviderId } from "@/lib/image-generation/types";

/**
 * The image catalog is the single source of truth for the owner-facing model
 * picker and the server-side capability checks. Keep entries here only when the
 * current provider adapter has been verified against that model.
 */
export type ImageModelDefinition = {
  id: string;
  provider: Extract<ImageProviderId, "together">;
  label: string;
  description: string;
  qualityNote?: string;
  supportsReferenceImages: boolean;
  supportsImageEditing: boolean;
  supportsSeed: boolean;
  recommended?: boolean;
  premium?: boolean;
};

export const IMAGE_MODELS = {
  "Qwen/Qwen-Image-2.0": {
    id: "Qwen/Qwen-Image-2.0",
    provider: "together",
    label: "Qwen Image 2.0",
    description: "Best balance for Cabi generation and reference-image consistency.",
    supportsReferenceImages: true,
    supportsImageEditing: true,
    supportsSeed: true,
    recommended: true,
  },
  "Qwen/Qwen-Image-2.0-Pro": {
    id: "Qwen/Qwen-Image-2.0-Pro",
    provider: "together",
    label: "Qwen Image 2.0 Pro",
    description: "Use when you want maximum visual quality for a final generation.",
    qualityNote: "Highest quality · higher generation cost",
    supportsReferenceImages: true,
    supportsImageEditing: true,
    supportsSeed: true,
    premium: true,
  },
  "Qwen/Qwen-Image": {
    id: "Qwen/Qwen-Image",
    provider: "together",
    label: "Qwen Image",
    description: "Verified text-to-image option for scenes that do not need direct reference conditioning.",
    qualityNote: "Text-to-image only",
    supportsReferenceImages: false,
    supportsImageEditing: false,
    supportsSeed: true,
  },
} satisfies Record<string, ImageModelDefinition>;

export type ImageModelId = keyof typeof IMAGE_MODELS;

export const IMAGE_PROVIDER_OPTIONS = [
  {
    id: "together" as const,
    label: "Together AI",
    description: "Verified image generation and reference conditioning for Cabi.",
  },
] as const;

export type ImageProviderOption = (typeof IMAGE_PROVIDER_OPTIONS)[number];

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
  return IMAGE_PROVIDER_OPTIONS.some((provider) => provider.id === value);
}

export function isImageModelForProvider(provider: string, modelId: string): boolean {
  return imageModelFor(provider, modelId) !== null;
}

export function recommendedImageModel(provider = "together"): ImageModelDefinition {
  return imageModelsForProvider(provider).find((model) => model.recommended)
    ?? imageModelsForProvider(provider)[0]
    ?? IMAGE_MODELS["Qwen/Qwen-Image-2.0"];
}
