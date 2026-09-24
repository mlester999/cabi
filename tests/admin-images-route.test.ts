import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  audit: vi.fn(),
  readSettings: vi.fn(),
  readStored: vi.fn(),
  readEnvironment: vi.fn(),
  resolveConfig: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  capabilities: vi.fn(),
  testConnection: vi.fn(),
  fullTest: vi.fn(),
  database: vi.fn(),
  configs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/admin/auth", () => ({ adminOrResponse: mocks.admin }));
vi.mock("@/lib/admin/audit", () => ({ auditAdmin: mocks.audit }));
vi.mock("@/lib/db/supabase", () => ({ getServiceClient: mocks.database }));
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
  resolveImageGenerationConfig: mocks.resolveConfig,
  removeImageApiKey: mocks.remove,
  writeImageSettings: mocks.write,
}));
vi.mock("@/lib/image-generation/full-test", () => ({ runFullCabiImageTest: mocks.fullTest }));

import { GET, POST } from "@/app/api/admin/images/route";

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
  for (const mock of [mocks.admin, mocks.audit, mocks.readSettings, mocks.readStored, mocks.readEnvironment, mocks.resolveConfig, mocks.write, mocks.remove, mocks.create, mocks.capabilities, mocks.testConnection, mocks.fullTest, mocks.database]) mock.mockReset();
  mocks.configs.length = 0;
  mocks.admin.mockResolvedValue({ session: { email: "owner@example.test" }, response: null });
  mocks.audit.mockResolvedValue(undefined);
  mocks.readSettings.mockResolvedValue({ ...settings, hasApiKey: true, keyLastFour: "ored", apiKeySource: "admin" });
  mocks.readStored.mockResolvedValue({ settings, apiKey: "stored-together-key", apiKeySource: "admin" });
  mocks.readEnvironment.mockReturnValue("environment-key");
  mocks.resolveConfig.mockImplementation(async (selection?: { provider?: string; model?: string }) => {
    const stored = await mocks.readStored();
    const provider = selection?.provider ?? stored?.settings?.provider ?? "together";
    const model = selection?.model ?? stored?.settings?.model ?? settings.model;
    const apiKey = stored?.apiKey ?? mocks.readEnvironment();
    return {
      settings: { ...settings, provider, model, baseUrl: "https://api.together.xyz/v1/images/generations" },
      provider,
      model,
      endpoint: "https://api.together.xyz/v1/images/generations",
      apiKey,
      apiKeySource: stored?.apiKey ? "admin" : apiKey ? "environment" : null,
      capabilities: mocks.capabilities(),
      aspectRatio: "1:1",
      quality: "standard",
      limits: { daily: 5, allowGuestGeneration: false },
    };
  });
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
  mocks.fullTest.mockResolvedValue({
    ok: true,
    message: "Full Cabi generation, image download, private upload, and signed URL verified.",
    trace: { snapshot: () => ({ requestId: "trace-1", source: "ADMIN_TEST", wallet: null, conversation: null, provider: "together", model: settings.model, referenceVersion: 3, referenceAttached: true, aspectRatio: "1:1", width: 1024, height: 1024, stage: null, lastStage: "FINAL_RESPONSE_RETURNED", httpStatus: null, contentType: "image/png", byteLength: 256, error: null, latencyMs: 12, events: [] }) },
    referenceConditioned: true,
    referenceFallbackUsed: false,
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

  it("tests the current canonical selection instead of the saved model", async () => {
    const response = await POST(request({ provider: "together", model: "Qwen/Qwen-Image-2.0-Pro", action: "test" }));
    expect(response.status).toBe(200);
    expect(mocks.configs[0]).toMatchObject({ provider: "together", model: "Qwen/Qwen-Image-2.0-Pro" });
    const payload = await response.json() as { diagnostics?: Record<string, unknown> };
    expect(payload.diagnostics).toMatchObject({
      providerReceived: "together",
      providerValid: true,
      modelReceived: "Qwen/Qwen-Image-2.0-Pro",
      modelValid: true,
      storedKeyPresent: true,
    });
  });

  it("does not use an unsaved browser key for a connection test", async () => {
    mocks.readStored.mockResolvedValue(null);
    const response = await POST(request({ ...settings, action: "test", apiKey: "typed-unsaved-key" }));
    expect(response.status).toBe(200);
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

  it("runs the full stored-config generation test without using browser selections", async () => {
    const response = await POST(request({ action: "test-full" }));
    expect(response.status).toBe(200);
    expect(mocks.fullTest).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ provider: "together", model: settings.model, apiKey: "stored-together-key" }),
      trace: expect.anything(),
    }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: true, referenceConditioned: true, referenceFallbackUsed: false });
  });

  it("returns recent generation activity across all lifecycle states", async () => {
    const rows = [
      { id: "queued-1", created_at: "2026-03-01T00:00:00Z", status: "QUEUED", wallet_account_id: "wallet-1", pipeline_request_id: "trace-1" },
      { id: "running-1", created_at: "2026-03-01T00:01:00Z", status: "GENERATING", provider: "together", model: settings.model, http_status: 403, provider_error_category: "organization_permission" },
      { id: "complete-1", created_at: "2026-03-01T00:02:00Z", status: "COMPLETED", model: settings.model },
    ];
    mocks.database.mockReturnValue({
      from: () => {
        const query: Record<string, unknown> = {};
        query.select = vi.fn(() => query);
        query.order = vi.fn(() => query);
        query.limit = vi.fn(async () => ({ data: rows, error: null }));
        return query;
      },
    });
    const response = await GET(new Request("http://localhost:5173/api/admin/images?section=errors"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      detailedDiagnosticsAvailable: true,
      errors: [
        { id: "queued-1", status: "QUEUED" },
        { id: "running-1", status: "GENERATING", httpStatus: 403, category: "organization_permission" },
        { id: "complete-1", status: "COMPLETED" },
      ],
    });
  });

  it("falls back to basic activity when optional diagnostic columns are missing", async () => {
    let queryCount = 0;
    mocks.database.mockReturnValue({
      from: () => {
        queryCount += 1;
        const current = queryCount;
        const query: Record<string, unknown> = {};
        query.select = vi.fn(() => query);
        query.order = vi.fn(() => query);
        query.limit = vi.fn(async () => current === 1
          ? { data: null, error: { code: "PGRST204", message: "Could not find the 'pipeline_request_id' column of 'image_generations' in the schema cache" } }
          : { data: [{ id: "run-1", created_at: "2026-03-01T00:00:00Z", status: "GENERATING" }], error: null });
        return query;
      },
    });
    const response = await GET(new Request("http://localhost:5173/api/admin/images?section=errors"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      detailedDiagnosticsAvailable: false,
      errors: [{ id: "run-1", status: "GENERATING" }],
    });
  });
});
