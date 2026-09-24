import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider capability.
 *
 * The requirement this suite protects: a model that cannot condition on a
 * reference image must never be sent one, and the admin console must be told the
 * truth rather than being promised consistency the model cannot deliver.
 */

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/ai/image/together", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/image/together")>();
  return {
    ...actual,
    generateTogetherImage: mocks.generate,
    testTogetherConnection: async () => ({ ok: true, model: "stub", message: "Connected." }),
  };
});

import { createImageProvider, imageCapabilitiesFor } from "@/lib/image-generation/provider";
import { supportsReferenceImages, defaultTogetherImageModel } from "@/lib/ai/image/together";
import { noImageCapabilities } from "@/lib/image-generation/types";

const apiKey = "test-key-not-real";

beforeEach(() => {
  mocks.generate.mockReset();
  mocks.generate.mockResolvedValue({
    ok: true,
    image: { bytes: new Uint8Array(256).fill(3), contentType: "image/png", provider: "together", model: "stub", width: 1024, height: 1024 },
  });
});

describe("capability is derived from the model, not the provider", () => {
  it("reports the recommended Qwen Image 2.0 model as reference-capable", () => {
    const capabilities = imageCapabilitiesFor({ provider: "together", model: defaultTogetherImageModel });
    expect(defaultTogetherImageModel).toBe("Qwen/Qwen-Image-2.0");
    expect(capabilities.supportsReferenceImages).toBe(true);
    expect(capabilities.supportsImageToImage).toBe(true);
  });

  it("reports the premium Qwen Image 2.0 Pro model as reference-capable", () => {
    const capabilities = imageCapabilitiesFor({ provider: "together", model: "Qwen/Qwen-Image-2.0-Pro" });
    expect(capabilities.supportsReferenceImages).toBe(true);
    expect(capabilities.supportsImageToImage).toBe(true);
    expect(capabilities.supportsSeed).toBe(true);
  });

  it("matches only exact curated catalog entries", () => {
    expect(supportsReferenceImages("qwen/qwen-image-2.0")).toBe(false);
    expect(supportsReferenceImages("black-forest-labs/FLUX.1-Kontext-pro")).toBe(false);
    expect(supportsReferenceImages("Qwen/Qwen-Image-2.0")).toBe(true);
    expect(supportsReferenceImages("Qwen/Qwen-Image")).toBe(false);
    expect(supportsReferenceImages("")).toBe(false);
  });

  it("claims nothing for the OpenAI-compatible text-to-image adapter", () => {
    // `/images/generations` has no image input, so the capability says so instead
    // of advertising conditioning the request would silently drop.
    const provider = createImageProvider({ provider: "openai", apiKey, baseUrl: "https://api.example.com/v1", model: "gpt-image-1", supportsReferenceImage: false });
    expect(provider.capabilities).toEqual(noImageCapabilities);
    expect(provider.supportsReferenceImage).toBe(false);
  });

  it("claims nothing for an unconfigured provider", () => {
    const provider = createImageProvider({ provider: "together", apiKey: "", model: "Qwen/Qwen-Image-2.0", supportsReferenceImage: false });
    expect(provider.capabilities).toEqual(noImageCapabilities);
    expect(provider.label).toBe("Not configured");
  });
});

describe("the reference reaches the provider only when it is supported", () => {
  it("forwards the assembled prompt to a text-to-image model", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: "Qwen/Qwen-Image", supportsReferenceImage: false });
    await provider.generateCabiImage({ scene: "at the beach", aspectRatio: "1:1", preparedPrompt: "IDENTITY LAYERS Scene: at the beach." });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    // The prepared prompt is passed through rather than re-wrapped, so the identity
    // layers are not duplicated.
    expect(request.preparedPrompt).toBe("IDENTITY LAYERS Scene: at the beach.");
  });

  it("leaves reference images undefined for a model without conditioning", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: "Qwen/Qwen-Image", supportsReferenceImage: false });
    await provider.generateCabiImage({ scene: "in a hoodie", aspectRatio: "1:1", referenceImages: undefined });
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    expect(request.referenceImages).toBeUndefined();
  });

  it("passes the reference through automatically for a capable model", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: "Qwen/Qwen-Image-2.0", supportsReferenceImage: true });
    const reference = ["https://example.test/official/cabi-reference.png"];
    await provider.generateCabiImage({ scene: "in a hoodie", aspectRatio: "1:1", referenceImages: reference });
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    expect(request.referenceImages).toEqual(reference);
  });
});
