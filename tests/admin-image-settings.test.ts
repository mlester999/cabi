import { describe, expect, it } from "vitest";

import { imageAdminSaveSchema } from "@/app/api/admin/images/route";

const valid = {
  enabled: true,
  provider: "together",
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  action: "save",
} as const;

describe("admin image settings contract", () => {
  it("accepts only a catalog-backed Together model", () => {
    expect(imageAdminSaveSchema.safeParse(valid).success).toBe(true);
    expect(imageAdminSaveSchema.safeParse({ ...valid, model: "Qwen/Qwen-Image-2.0-Pro" }).success).toBe(true);
  });

  it("rejects arbitrary models and base URL injection", () => {
    expect(imageAdminSaveSchema.safeParse({ ...valid, model: "black-forest-labs/FLUX.1-schnell" }).success).toBe(false);
    expect(imageAdminSaveSchema.safeParse({ ...valid, baseUrl: "https://evil.example/v1" }).success).toBe(false);
    expect(imageAdminSaveSchema.safeParse({ ...valid, provider: "openai-compatible" }).success).toBe(false);
    expect(imageAdminSaveSchema.safeParse({ provider: "Together AI", model: "Qwen Image 2.0 · Recommended", action: "test" }).success).toBe(false);
  });

  it("allows a connection test to validate only the current canonical selection", () => {
    expect(imageAdminSaveSchema.safeParse({ provider: "together", model: "Qwen/Qwen-Image-2.0", action: "test" }).success).toBe(true);
    expect(imageAdminSaveSchema.safeParse({ provider: "together", model: "Qwen Image 2.0", action: "test" }).success).toBe(false);
  });
});
