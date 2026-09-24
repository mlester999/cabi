import { afterEach, describe, expect, it, vi } from "vitest";

import { executeImageGeneration } from "@/lib/image-generation/execute";
import type { ImageGenerationProvider } from "@/lib/image-generation/provider";
import type { ResolvedImageGenerationConfig } from "@/lib/image-generation/settings";
import type { ImageGenerationResult } from "@/lib/image-generation/types";

const imageResult: ImageGenerationResult = {
  ok: true,
  image: {
    bytes: new Uint8Array(256).fill(7),
    contentType: "image/png",
    provider: "together",
    model: "Qwen/Qwen-Image-2.0",
    width: 1024,
    height: 1024,
  },
};

const config: ResolvedImageGenerationConfig = {
  settings: {
    enabled: true,
    provider: "together",
    baseUrl: "https://api.together.xyz/v1/images/generations",
    model: "Qwen/Qwen-Image-2.0",
    defaultAspectRatio: "1:1",
    defaultQuality: "standard",
    dailyLimit: 5,
    allowGuestGeneration: false,
  },
  provider: "together",
  model: "Qwen/Qwen-Image-2.0",
  endpoint: "https://api.together.xyz/v1/images/generations",
  apiKey: "stored-key-never-returned",
  apiKeySource: "admin",
  capabilities: { supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true },
  aspectRatio: "1:1",
  quality: "standard",
  limits: { daily: 5, allowGuestGeneration: false },
};

function provider(results: ImageGenerationResult[]): ImageGenerationProvider {
  return {
    id: "together",
    label: "Together AI",
    supportsReferenceImage: true,
    capabilities: config.capabilities,
    generateCabiImage: vi.fn(async () => results.shift() ?? imageResult),
    testConnection: vi.fn(async () => ({ ok: true as const, model: config.model, message: "Connected." })),
  };
}

const request = {
  scene: "Cabi in a hoodie",
  aspectRatio: "1:1" as const,
  quality: "standard" as const,
  referenceImages: ["https://storage.example/signed/reference.png"],
  preparedPrompt: "private prompt layers",
};

describe("image execution fallback", () => {
  afterEach(() => {
    delete process.env.IMAGE_GENERATION_DIAGNOSTICS;
  });

  it("retries text-only after a reference-bearing 403 and records the successful request as unconditioned", async () => {
    const client = provider([
      { ok: false, error: "PROVIDER_ERROR", message: "Reference image rejected", httpStatus: 403, providerErrorCategory: "reference_input" },
      imageResult,
    ]);

    const result = await executeImageGeneration({
      source: "CHAT_GENERATION",
      config,
      provider: client,
      request,
      referenceVersion: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.referenceConditioned).toBe(false);
    expect(result.referenceFallbackUsed).toBe(true);
    expect(client.generateCabiImage).toHaveBeenCalledTimes(2);
    expect(client.generateCabiImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ referenceImages: undefined }));
  });

  it.each([
    [401, "NOT_CONFIGURED"],
    [402, "PROVIDER_ERROR"],
    [429, "RATE_LIMITED"],
    [503, "PROVIDER_ERROR"],
  ] as const)("does not retry a %i provider response", async (httpStatus, error) => {
    const client = provider([{ ok: false, error, message: "provider detail", httpStatus }]);
    const result = await executeImageGeneration({
      source: "HTTP_GENERATION",
      config,
      provider: client,
      request,
      referenceVersion: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.referenceFallbackUsed).toBe(false);
    expect(client.generateCabiImage).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 403 when no reference was attached", async () => {
    const client = provider([{ ok: false, error: "PROVIDER_ERROR", message: "provider detail", httpStatus: 403 }]);
    const result = await executeImageGeneration({
      source: "CHAT_GENERATION",
      config,
      provider: client,
      request: { ...request, referenceImages: undefined },
      referenceVersion: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.referenceFallbackUsed).toBe(false);
    expect(client.generateCabiImage).toHaveBeenCalledTimes(1);
  });

  it("does not retry a generic 403 that is not proven to be reference-specific", async () => {
    const client = provider([{ ok: false, error: "PROVIDER_ERROR", message: "provider detail", httpStatus: 403 }]);
    const result = await executeImageGeneration({
      source: "CHAT_GENERATION",
      config,
      provider: client,
      request,
      referenceVersion: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.referenceFallbackUsed).toBe(false);
    expect(client.generateCabiImage).toHaveBeenCalledTimes(1);
  });

  it("logs comparison metadata without secrets, prompts, or signed URLs", async () => {
    process.env.IMAGE_GENERATION_DIAGNOSTICS = "1";
    const logged: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args) => logged.push(args.map(String).join(" ")));
    await executeImageGeneration({
      source: "CHAT_GENERATION",
      config,
      provider: provider([imageResult]),
      request,
      referenceVersion: 4,
    });
    spy.mockRestore();
    const record = logged.join(" ");
    expect(record).toContain("CHAT_GENERATION");
    expect(record).toContain("https-url");
    expect(record).not.toContain("stored-key-never-returned");
    expect(record).not.toContain("storage.example/signed/reference.png");
    expect(record).not.toContain("private prompt layers");
  });
});
