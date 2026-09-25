import { describe, expect, it } from "vitest";

import {
  IMAGE_PROVIDERS,
  IMAGE_MODELS,
  IMAGE_PROVIDER_OPTIONS,
  imageModelFor,
  recommendedImageModel,
} from "@/lib/image-generation/registry";
import {
  canonicalizeImageSelection,
  isLegacyImageSettings,
  needsImageSettingsNormalization,
  parseImageSettings,
} from "@/lib/image-generation/settings";
import { togetherImageEndpoint } from "@/lib/ai/image/together";

describe("curated image catalog", () => {
  it("exposes Together AI as the only owner-facing provider", () => {
    expect(IMAGE_PROVIDER_OPTIONS.map((provider) => provider.id)).toEqual(["together"]);
    expect(IMAGE_PROVIDER_OPTIONS[0]?.label).toBe("Together AI");
    expect(IMAGE_PROVIDERS.together.endpoint).toBe("https://api.together.xyz/v1/images/generations");
  });

  it("keeps the recommended and curated reference-capable models explicit", () => {
    expect(recommendedImageModel("together").id).toBe("Qwen/Qwen-Image-2.0");
    expect(Object.keys(IMAGE_MODELS)).toEqual([
      "Qwen/Qwen-Image-2.0",
      "Qwen/Qwen-Image-2.0-Pro",
      "Qwen/Qwen-Image",
      "black-forest-labs/FLUX.1-kontext-pro",
    ]);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0"].supportsSteps).toBe(false);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0-Pro"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0-Pro"].supportsSteps).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].supportsSteps).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].referenceParameter).toBe("image_url");
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].supportsImageEditing).toBe(true);
    expect(IMAGE_MODELS["black-forest-labs/FLUX.1-kontext-pro"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["black-forest-labs/FLUX.1-kontext-pro"].referenceParameter).toBe("image_url");
    expect(imageModelFor("together", "Qwen/Qwen-Image-Edit")).toBeNull();
  });

  it("keeps model labels, badges, and use cases in the registry", () => {
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0"].badges).toEqual(["Recommended", "Reference Ready", "Image Editing"]);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0-Pro"].badges[0]).toBe("Highest Quality");
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].badges).toEqual(["Budget", "Text to Image", "Reference Ready", "Image Editing"]);
    expect(IMAGE_MODELS["black-forest-labs/FLUX.1-kontext-pro"].useCase).toContain("identity");
  });

  it("keeps a saved non-default Together selection canonical", () => {
    expect(parseImageSettings({ provider: "together", model: "Qwen/Qwen-Image-2.0-Pro" })).toMatchObject({
      provider: "together",
      model: "Qwen/Qwen-Image-2.0-Pro",
      baseUrl: togetherImageEndpoint,
    });
  });

  it("keeps friendly labels out of canonical selection values", () => {
    const selection = canonicalizeImageSelection({ provider: "Together AI", model: "Qwen Image 2.0 · Recommended" });
    expect(selection.provider).toBe("together");
    expect(selection.model).toBe("Qwen/Qwen-Image-2.0");
    expect(isLegacyImageSettings({ provider: "Together AI", model: "Qwen Image 2.0 · Recommended" })).toBe(true);
    expect(needsImageSettingsNormalization({ provider: "Together AI", model: "Qwen Image 2.0 · Recommended" })).toBe(true);
    expect(parseImageSettings({ provider: "Together AI", model: "Qwen Image 2.0 · Recommended" })).toMatchObject({
      provider: "together",
      model: "Qwen/Qwen-Image-2.0",
    });
  });
});

describe("safe image settings normalization", () => {
  it("moves the shipped OpenAI defaults to Together/Qwen 2.0", () => {
    const stale = {
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-image-1",
      defaultAspectRatio: "1:1",
      defaultQuality: "standard",
      dailyLimit: 5,
      allowGuestGeneration: false,
    };
    expect(isLegacyImageSettings(stale)).toBe(true);
    expect(needsImageSettingsNormalization(stale)).toBe(true);
    const normalized = parseImageSettings(stale);
    expect(normalized.provider).toBe("together");
    expect(normalized.model).toBe("Qwen/Qwen-Image-2.0");
    expect(normalized.baseUrl).toBe(togetherImageEndpoint);
  });

  it("does not overwrite a deliberately configured non-Together adapter", () => {
    const deliberate = {
      enabled: true,
      provider: "custom",
      baseUrl: "https://images.internal.example/v1",
      model: "internal-image-model",
      defaultAspectRatio: "16:9",
      defaultQuality: "high",
      dailyLimit: 12,
      allowGuestGeneration: false,
    };
    expect(isLegacyImageSettings(deliberate)).toBe(false);
    expect(needsImageSettingsNormalization(deliberate)).toBe(false);
    expect(parseImageSettings(deliberate)).toMatchObject({
      provider: "custom",
      baseUrl: "https://images.internal.example/v1",
      model: "internal-image-model",
    });
  });

  it("does not mistake an intentional OpenAI model for the shipped default", () => {
    const deliberate = {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "custom-production-image-model",
    };
    expect(isLegacyImageSettings(deliberate)).toBe(false);
    expect(needsImageSettingsNormalization(deliberate)).toBe(false);
    expect(parseImageSettings(deliberate)).toMatchObject(deliberate);
  });

  it("canonicalizes an unknown Together model without accepting it", () => {
    const normalized = parseImageSettings({ provider: "together", model: "made-up/model", baseUrl: "https://evil.example/v1" });
    expect(normalized.provider).toBe("together");
    expect(normalized.model).toBe("Qwen/Qwen-Image-2.0");
    expect(normalized.baseUrl).toBe(togetherImageEndpoint);
  });
});
