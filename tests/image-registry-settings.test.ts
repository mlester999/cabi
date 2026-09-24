import { describe, expect, it } from "vitest";

import {
  IMAGE_MODELS,
  IMAGE_PROVIDER_OPTIONS,
  imageModelFor,
  recommendedImageModel,
} from "@/lib/image-generation/registry";
import {
  isLegacyImageSettings,
  needsImageSettingsNormalization,
  parseImageSettings,
} from "@/lib/image-generation/settings";
import { togetherImageEndpoint } from "@/lib/ai/image/together";

describe("curated image catalog", () => {
  it("exposes Together AI as the only owner-facing provider", () => {
    expect(IMAGE_PROVIDER_OPTIONS.map((provider) => provider.id)).toEqual(["together"]);
    expect(IMAGE_PROVIDER_OPTIONS[0]?.label).toBe("Together AI");
  });

  it("keeps the recommended and premium reference-capable models explicit", () => {
    expect(recommendedImageModel("together").id).toBe("Qwen/Qwen-Image-2.0");
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image-2.0-Pro"].supportsReferenceImages).toBe(true);
    expect(IMAGE_MODELS["Qwen/Qwen-Image"].supportsReferenceImages).toBe(false);
    expect(imageModelFor("together", "Qwen/Qwen-Image-Edit")).toBeNull();
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
