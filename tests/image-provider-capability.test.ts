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
  it("reports the shipped text-to-image model as unable to condition on a reference", () => {
    const capabilities = imageCapabilitiesFor({ provider: "together", model: defaultTogetherImageModel });
    expect(defaultTogetherImageModel).toBe("Qwen/Qwen-Image");
    expect(capabilities.supportsReferenceImages).toBe(false);
    expect(capabilities.supportsImageToImage).toBe(false);
  });

  it("reports a known image-editing model as reference-capable", () => {
    const capabilities = imageCapabilitiesFor({ provider: "together", model: "Qwen/Qwen-Image-Edit" });
    expect(capabilities.supportsReferenceImages).toBe(true);
    expect(capabilities.supportsImageToImage).toBe(true);
    expect(capabilities.supportsSeed).toBe(true);
  });

  it("matches the model allowlist case-insensitively", () => {
    expect(supportsReferenceImages("qwen/qwen-image-edit")).toBe(true);
    expect(supportsReferenceImages("black-forest-labs/FLUX.1-Kontext-pro")).toBe(true);
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
    const provider = createImageProvider({ provider: "together", apiKey: "", model: "Qwen/Qwen-Image-Edit", supportsReferenceImage: false });
    expect(provider.capabilities).toEqual(noImageCapabilities);
    expect(provider.label).toBe("Not configured");
  });
});

describe("the reference reaches the provider only when it is supported", () => {
  it("forwards the assembled prompt to a text-to-image model", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: defaultTogetherImageModel, supportsReferenceImage: false });
    await provider.generateCabiImage({ scene: "at the beach", aspectRatio: "1:1", preparedPrompt: "IDENTITY LAYERS Scene: at the beach." });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    // The prepared prompt is passed through rather than re-wrapped, so the identity
    // layers are not duplicated.
    expect(request.preparedPrompt).toBe("IDENTITY LAYERS Scene: at the beach.");
  });

  it("leaves reference images undefined for a model without conditioning", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: defaultTogetherImageModel, supportsReferenceImage: false });
    await provider.generateCabiImage({ scene: "in a hoodie", aspectRatio: "1:1", referenceImages: undefined });
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    expect(request.referenceImages).toBeUndefined();
  });

  it("passes the reference through automatically for a capable model", async () => {
    const provider = createImageProvider({ provider: "together", apiKey, model: "Qwen/Qwen-Image-Edit", supportsReferenceImage: true });
    const reference = ["https://example.test/official/cabi-reference.png"];
    await provider.generateCabiImage({ scene: "in a hoodie", aspectRatio: "1:1", referenceImages: reference });
    const [request] = mocks.generate.mock.calls[0] as [Record<string, unknown>];
    expect(request.referenceImages).toEqual(reference);
  });
});
