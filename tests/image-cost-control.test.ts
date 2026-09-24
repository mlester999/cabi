import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cost control: a refused request must never reach the provider.
 *
 * These tests count real `fetch` invocations rather than trusting the pipeline's
 * own bookkeeping. The guarantee being protected is financial — if an unrelated
 * prompt can reach Together AI, a user can spend the owner's credits on images
 * the product does not make.
 */

const mocks = {
  enabled: true,
  quotaAllowed: true,
  inserted: [] as Array<Record<string, unknown>>,
};

/*
 * The lifecycle transitions write to the database. Mocked here so these tests
 * exercise the decision path — what reaches the provider and what does not —
 * without needing a database. The transition sequence itself is covered by
 * tests/image-lifecycle.test.ts.
 */
vi.mock("@/lib/image-generation/lifecycle", () => ({
  markGenerating: vi.fn(async () => undefined),
  markCompleted: vi.fn(async () => undefined),
  markFailed: vi.fn(async () => undefined),
  linkGenerationToMessage: vi.fn(async () => undefined),
  refreshCardUrl: vi.fn(async (card: unknown) => card),
  refreshStoredCards: vi.fn(async (messages: unknown) => messages),
  readQuota: vi.fn(async () => ({ used: 0, remaining: 5, allowed: true, dailyLimit: 5, failedToday: 0, inFlight: 0, resetsAt: null })),
  readGeneration: vi.fn(async () => null),
  deleteGeneration: vi.fn(async () => ({ ok: true })),
  cardUrlTtlSeconds: 600,
}));
vi.mock("@/lib/image-generation/settings", () => ({
  readImageSettings: vi.fn(async () => ({
    enabled: mocks.enabled, provider: "together", baseUrl: "https://api.together.xyz/v1/images/generations",
    model: "Qwen/Qwen-Image-2.0", defaultAspectRatio: "1:1", defaultQuality: "standard",
    dailyLimit: 5, allowGuestGeneration: false, hasApiKey: true, keyLastFour: "abcd",
  })),
  readImageProviderConfig: vi.fn(async () => ({
    settings: {
      enabled: mocks.enabled, provider: "together", baseUrl: "https://api.together.xyz/v1/images/generations",
      model: "Qwen/Qwen-Image-2.0", defaultAspectRatio: "1:1", defaultQuality: "standard",
      dailyLimit: 5, allowGuestGeneration: false,
    },
    apiKey: "fake-key-for-tests-only",
  })),
}));

vi.mock("@/lib/image-generation/provider", () => ({
  imageCapabilitiesFor: () => ({ supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true }),
  createImageProvider: () => ({
    id: "together", label: "Together AI", supportsReferenceImage: true,
    capabilities: { supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true },
    generateCabiImage: async () => {
      providerCalls += 1;
      return { ok: true, image: { bytes: new Uint8Array(256).fill(7), contentType: "image/png", provider: "together", model: "Qwen/Qwen-Image-2.0", width: 1024, height: 1024 } };
    },
    testConnection: async () => ({ ok: true, model: "Qwen/Qwen-Image-2.0", message: "Connected." }),
  }),
}));

vi.mock("@/lib/image-generation/storage", () => ({
  generationBucket: "cabi-generations", avatarBucket: "avatars",
  uploadGenerationImage: vi.fn(async () => ({ ok: true, path: "wallet/gen.png" })),
  signedImageUrl: vi.fn(async () => "https://storage.example.com/signed/gen.png"),
  uploadAvatar: vi.fn(async () => ({ ok: true, path: "wallet/avatar.png" })),
  validateAvatarBytes: vi.fn(() => ({ ok: true, contentType: "image/png", extension: "png" })),
  stripJpegMetadata: vi.fn((bytes: Uint8Array) => bytes),
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserted.push({ table, ...row });
        return { select: () => ({ maybeSingle: async () => ({ data: { id: "11111111-1111-1111-1111-111111111111", created_at: "2026-01-01T00:00:00.000Z" }, error: null }) }) };
      },
    }),
    rpc: async () => ({ data: [{ allowed: mocks.quotaAllowed, remaining: 4 }], error: null }),
  }),
}));

vi.mock("@/lib/ranking/service", () => ({
  awardImageXp: vi.fn(async () => ({ xpAwarded: 5, seasonXp: 5, lifetimeXp: 5, tier: { tier: 1 }, previousTier: { tier: 1 }, rankedUp: false, capped: false, reasonCode: "FIRST_OF_DAY", label: null, seasonId: null })),
  countImageXpToday: vi.fn(async () => 0),
}));

vi.mock("@/lib/profiles/service", () => ({
  readProfile: vi.fn(async () => ({ profileCompletedAt: "2026-01-01T00:00:00.000Z", username: "mark" })),
}));

let providerCalls = 0;
let fetchCalls = 0;
const realFetch = globalThis.fetch;

import { generateChatImage } from "@/lib/image-generation/chat";

const wallet = { walletAccountId: "22222222-2222-2222-2222-222222222222", conversationId: null, messageId: null };

beforeEach(() => {
  providerCalls = 0;
  fetchCalls = 0;
  mocks.enabled = true;
  mocks.quotaAllowed = true;
  mocks.inserted = [];
  process.env.TOGETHER_API_KEY = "fake-key-for-tests-only";
  // Any network call at all is a failure of the cost guarantee.
  globalThis.fetch = vi.fn(async () => { fetchCalls += 1; throw new Error("network access in a cost-control test"); }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TOGETHER_API_KEY;
});

describe("refused requests cost nothing", () => {
  const unrelated = [
    "Generate Cristiano Ronaldo",
    "Make a picture of a Lamborghini",
    "Generate an anime girlfriend",
    "Make a random landscape",
    "Create a Bitcoin logo",
    "Generate a dog",
    "Generate a sports car",
  ];

  it.each(unrelated)("%s never reaches the provider", async (prompt) => {
    const result = await generateChatImage(prompt, wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(providerCalls).toBe(0);
    // The strongest assertion: no HTTP request was made at all.
    expect(fetchCalls).toBe(0);
    // And nothing was written to the generation table.
    expect(mocks.inserted.filter((row) => row.table === "image_generations")).toHaveLength(0);
  });

  it("an ambiguous request asks instead of generating", async () => {
    const result = await generateChatImage("put her in a gaming chair", { ...wallet, conversationContext: [] });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  it("a back-reference WITH context does generate", async () => {
    const result = await generateChatImage("put her in a gaming chair", { ...wallet, conversationContext: ["tell me about Cabi"] });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(true);
  });

  it("a valid Cabi request does reach the provider", async () => {
    const result = await generateChatImage("Cabi playing on a gaming PC", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(true);
    expect(providerCalls).toBe(1);
  });

  it("refuses without a wallet rather than spending credits", async () => {
    const result = await generateChatImage("Cabi at the beach", { walletAccountId: null, conversationId: null, messageId: null });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(providerCalls).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  it("refuses on quota exhaustion before generating", async () => {
    mocks.quotaAllowed = false;
    const result = await generateChatImage("Cabi at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(providerCalls).toBe(0);
  });

  it("refuses while the feature is switched off", async () => {
    mocks.enabled = false;
    const result = await generateChatImage("Cabi at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(fetchCalls).toBe(0);
  });
});

describe("provider identity is never disclosed to a client", () => {
  it("omits the model and provider from a success card", async () => {
    const result = await generateChatImage("Cabi at the beach", wallet);
    if (!result.handled) return;
    const serialized = JSON.stringify(result);
    for (const leaked of ["Qwen", "Together", "together", "api.together.xyz"]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});
