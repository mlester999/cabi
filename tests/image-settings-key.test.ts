import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    setting: { value_json: Record<string, unknown> } | null;
    secret: { encrypted_value: unknown; last_four: string } | null;
    upserts: Array<{ table: string; row: Record<string, unknown> }>;
  } = { setting: null, secret: null, upserts: [] };

  const db = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_column: string, key: string) {
              return {
                async maybeSingle() {
                  return { data: table === "app_settings" && key === "image_generation" ? state.setting : table === "secret_settings" && key === "image_generation_api_key" ? state.secret : null, error: null };
                },
              };
            },
          };
        },
        upsert(row: Record<string, unknown>) {
          state.upserts.push({ table, row });
          if (table === "app_settings") state.setting = { value_json: row.value_json as Record<string, unknown> };
          if (table === "secret_settings") state.secret = { encrypted_value: row.encrypted_value, last_four: String(row.last_four) };
          return { error: null };
        },
        delete() {
          return {
            async eq(_column: string, key: string) {
              if (table === "secret_settings" && key === "image_generation_api_key") state.secret = null;
              return { error: null };
            },
          };
        },
      };
    },
  };

  return { state, db };
});

vi.mock("@/lib/db/supabase", () => ({ getServiceClient: () => mocks.db }));

import { base64 } from "@/lib/security/crypto";
import {
  readImageProviderConfig,
  readStoredImageProviderConfig,
  readImageSettings,
  resolveImageGenerationConfig,
  writeImageSettings,
} from "@/lib/image-generation/settings";
import { togetherImageEndpoint } from "@/lib/ai/image/together";

const settings = {
  enabled: true,
  provider: "together",
  baseUrl: togetherImageEndpoint,
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
} as const;

const encryptionKey = base64.encode(new Uint8Array(32).fill(7));

beforeEach(() => {
  mocks.state.setting = null;
  mocks.state.secret = null;
  mocks.state.upserts = [];
  process.env.APP_ENCRYPTION_KEY = encryptionKey;
  delete process.env.TOGETHER_API_KEY;
});

afterEach(() => {
  delete process.env.APP_ENCRYPTION_KEY;
  delete process.env.TOGETHER_API_KEY;
});

describe("admin image key persistence", () => {
  it("trims, encrypts, persists, retrieves, and decrypts the exact saved key", async () => {
    const original = "  together-secret-value  ";
    await writeImageSettings(settings, "owner@example.test", original);

    const stored = await readStoredImageProviderConfig();
    expect(stored?.apiKey).toBe("together-secret-value");
    expect(stored?.apiKeySource).toBe("admin");
    expect(mocks.state.secret?.last_four).toBe("alue");
    expect(mocks.state.setting?.value_json.provider).toBe("together");
    expect(mocks.state.setting?.value_json.model).toBe("Qwen/Qwen-Image-2.0");
    expect(JSON.stringify(mocks.state.upserts)).not.toContain("together-secret-value");
  });

  it("normalizes friendly labels on reload and rewrites the saved canonical row", async () => {
    mocks.state.setting = {
      value_json: {
        ...settings,
        provider: "Together AI",
        model: "Qwen Image 2.0 · Recommended",
      },
    };

    const loaded = await readImageSettings();
    expect(loaded.provider).toBe("together");
    expect(loaded.model).toBe("Qwen/Qwen-Image-2.0");
    expect(mocks.state.setting?.value_json.provider).toBe("together");
    expect(mocks.state.setting?.value_json.model).toBe("Qwen/Qwen-Image-2.0");

    const reloaded = await readImageSettings();
    expect(reloaded.provider).toBe("together");
    expect(reloaded.model).toBe("Qwen/Qwen-Image-2.0");
  });

  it("preserves the existing encrypted key when the admin input is blank", async () => {
    await writeImageSettings(settings, "owner@example.test", "together-secret-value");
    const firstEnvelope = mocks.state.secret?.encrypted_value;
    mocks.state.upserts = [];

    await writeImageSettings(settings, "owner@example.test", "   ");

    expect(mocks.state.secret?.encrypted_value).toEqual(firstEnvelope);
    expect(mocks.state.upserts.some(({ table }) => table === "secret_settings")).toBe(false);
    expect((await readStoredImageProviderConfig())?.apiKey).toBe("together-secret-value");
  });

  it("never persists the masked suffix shown by the admin UI", async () => {
    await expect(writeImageSettings(settings, "owner@example.test", "••••••••••uvEA")).rejects.toThrow("MASKED_API_KEY");
    expect(mocks.state.upserts.some(({ table }) => table === "secret_settings")).toBe(false);
  });
});

describe("image key precedence", () => {
  it("prefers the decrypted admin key over the environment fallback", async () => {
    await writeImageSettings(settings, "owner@example.test", "stored-together-key");
    process.env.TOGETHER_API_KEY = "environment-key";

    const resolved = await readImageProviderConfig();
    expect(resolved?.apiKey).toBe("stored-together-key");
    expect(resolved?.apiKeySource).toBe("admin");
  });

  it("uses a trimmed environment key when no admin key is stored", async () => {
    mocks.state.setting = { value_json: settings };
    process.env.TOGETHER_API_KEY = "  environment-key  ";

    const resolved = await readImageProviderConfig();
    expect(resolved?.apiKey).toBe("environment-key");
    expect(resolved?.apiKeySource).toBe("environment");
    expect((await readImageSettings()).keyLastFour).toBe("-key");
  });

  it("does not let an empty environment value override an admin key", async () => {
    await writeImageSettings(settings, "owner@example.test", "stored-together-key");
    process.env.TOGETHER_API_KEY = "   ";

    expect((await readImageProviderConfig())?.apiKey).toBe("stored-together-key");
  });

  it("returns one canonical provider snapshot for the saved model and limits", async () => {
    await writeImageSettings({ ...settings, dailyLimit: 7, defaultQuality: "high" }, "owner@example.test", "stored-together-key");
    const resolved = await resolveImageGenerationConfig();
    expect(resolved).toMatchObject({
      provider: "together",
      model: "Qwen/Qwen-Image-2.0",
      endpoint: togetherImageEndpoint,
      apiKey: "stored-together-key",
      apiKeySource: "admin",
      aspectRatio: "1:1",
      quality: "high",
      limits: { daily: 7, allowGuestGeneration: false },
    });
    expect(resolved.capabilities).toMatchObject({ supportsReferenceImages: true, supportsSeed: true });
  });

  it("reads fresh settings on every resolution and can overlay only the admin test selection", async () => {
    await writeImageSettings({ ...settings, model: "Qwen/Qwen-Image-2.0-Pro" }, "owner@example.test", "stored-together-key");
    const saved = await resolveImageGenerationConfig();
    const liveTest = await resolveImageGenerationConfig({ provider: "together", model: "Qwen/Qwen-Image-2.0" });
    expect(saved.model).toBe("Qwen/Qwen-Image-2.0-Pro");
    expect(liveTest.model).toBe("Qwen/Qwen-Image-2.0");
    expect(liveTest.apiKey).toBe("stored-together-key");
  });
});
