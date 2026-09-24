import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  audit: vi.fn(),
  readSettings: vi.fn(),
  readStored: vi.fn(),
  readEnvironment: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  capabilities: vi.fn(),
  testConnection: vi.fn(),
  configs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/admin/auth", () => ({ adminOrResponse: mocks.admin }));
vi.mock("@/lib/admin/audit", () => ({ auditAdmin: mocks.audit }));
vi.mock("@/lib/image-generation/provider", () => ({
  createImageProvider: mocks.create,
  imageCapabilitiesFor: mocks.capabilities,
}));
vi.mock("@/lib/image-generation/settings", () => ({
  imageSettingsKey: "image_generation",
  isMaskedImageApiKey: (value: string) => /^[•·*…]{4,}[A-Za-z0-9]{4}$/u.test(value.trim()),
  normalizeImageApiKey: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
  parseImageSettings: (value: Record<string, unknown>) => ({
    ...value,
    baseUrl: "https://api.together.xyz/v1/images/generations",
  }),
  readImageSettings: mocks.readSettings,
  readStoredImageProviderConfig: mocks.readStored,
  resolveEnvironmentTogetherApiKey: mocks.readEnvironment,
  removeImageApiKey: mocks.remove,
  writeImageSettings: mocks.write,
}));

import { POST } from "@/app/api/admin/images/route";

const settings = {
  enabled: true,
  provider: "together",
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost:5173/api/admin/images", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of [mocks.admin, mocks.audit, mocks.readSettings, mocks.readStored, mocks.readEnvironment, mocks.write, mocks.remove, mocks.create, mocks.capabilities, mocks.testConnection]) mock.mockReset();
  mocks.configs.length = 0;
  mocks.admin.mockResolvedValue({ session: { email: "owner@example.test" }, response: null });
  mocks.audit.mockResolvedValue(undefined);
  mocks.readSettings.mockResolvedValue({ ...settings, hasApiKey: true, keyLastFour: "ored", apiKeySource: "admin" });
  mocks.readStored.mockResolvedValue({ settings, apiKey: "stored-together-key", apiKeySource: "admin" });
  mocks.readEnvironment.mockReturnValue("environment-key");
  mocks.write.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.capabilities.mockReturnValue({ supportsReferenceImages: true, supportsImageToImage: true, supportsImageEditing: true, supportsSeed: true });
  mocks.testConnection.mockResolvedValue({
    ok: true,
    model: "Qwen/Qwen-Image-2.0",
    message: "Connected.",
    diagnostics: { provider: "Together AI", endpoint: "https://api.together.xyz/v1/images/generations", keyLoaded: true, keySuffix: "-key", httpStatus: 200 },
  });
  mocks.create.mockImplementation((config: Record<string, unknown>) => {
    mocks.configs.push(config);
    return { testConnection: mocks.testConnection };
  });
});

describe("admin Together connection route", () => {
  it("uses the decrypted saved key even when the browser sends a different unsaved key", async () => {
    const response = await POST(request({ ...settings, action: "test", apiKey: "typed-unsaved-key" }));
    expect(response.status).toBe(200);
    expect(mocks.configs[0]?.apiKey).toBe("stored-together-key");
    expect(mocks.testConnection).toHaveBeenCalledWith();
    expect(JSON.stringify(await response.json())).not.toContain("stored-together-key");
  });

  it("uses the stored key when the API-key input is blank", async () => {
    await POST(request({ ...settings, action: "test" }));
    expect(mocks.configs[0]?.apiKey).toBe("stored-together-key");
  });

  it("uses the environment fallback only when no admin key can be decrypted", async () => {
    mocks.readStored.mockResolvedValue(null);
    await POST(request({ ...settings, action: "test" }));
    expect(mocks.configs[0]?.apiKey).toBe("environment-key");
  });

  it("never accepts a masked suffix as a replacement key", async () => {
    const response = await POST(request({ ...settings, action: "save", apiKey: "••••••••••uvEA" }));
    expect(response.status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not route the Together test through an OpenAI provider", async () => {
    const response = await POST(request({ ...settings, action: "test" }));
    expect(response.status).toBe(200);
    expect(mocks.configs[0]?.provider).toBe("together");
    expect(mocks.configs[0]?.baseUrl).toBe("https://api.together.xyz/v1/images/generations");
  });
});
