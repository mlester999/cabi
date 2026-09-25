import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chat-driven Cabi image generation.
 *
 * These tests exercise the real decision path a chat message takes: is this an
 * image request, is it in scope, is the user allowed, is there quota left. Only
 * the provider call is stubbed, because a live image API is an external
 * dependency this environment does not have.
 */

const mocks = {
  enabled: true,
  allowGuest: false,
  dailyLimit: 5,
  hasProvider: true,
  quotaAllowed: true,
  providerOk: true,
  insertError: null as unknown,
  inserted: [] as Array<Record<string, unknown>>,
  generated: [] as Array<Record<string, unknown>>,
  deletedObjects: [] as string[],
  /** How many image XP grants the ledger already holds for today. */
  xpGrantedToday: 0,
  /** Mirrors `xpRules.imageXpPerDay`. */
  imageXpPerDay: 1,
  quotaCalls: 0,
  xpCountCalls: 0,
  xpAwards: 0,
};

/*
 * The lifecycle transitions write to the database. Mocked here so these tests
 * exercise the decision path — what reaches the provider and what does not —
 * without needing a database. The transition sequence itself is covered by
 * tests/image-lifecycle.test.ts.
 *
 * `vi.hoisted` is required: `vi.mock` is hoisted above every const in the file,
 * so a plain object would still be uninitialised when the factory runs.
 */
const lifecycle = vi.hoisted(() => ({
  markGenerating: vi.fn(async () => true),
  markCompleted: vi.fn(async () => true),
  markFailed: vi.fn(async () => true),
}));
vi.mock("@/lib/image-generation/lifecycle", () => ({
  ...lifecycle,
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
    enabled: mocks.enabled,
    provider: "together",
    baseUrl: "https://api.together.xyz/v1/images/generations",
    model: "Qwen/Qwen-Image-2.0",
    defaultAspectRatio: "1:1",
    defaultQuality: "standard",
    dailyLimit: mocks.dailyLimit,
    allowGuestGeneration: mocks.allowGuest,
    hasApiKey: mocks.hasProvider,
    keyLastFour: mocks.hasProvider ? "abcd" : null,
  })),
  readImageProviderConfig: vi.fn(async () => (mocks.hasProvider
    ? {
      settings: {
        enabled: mocks.enabled, provider: "together", baseUrl: "https://api.together.xyz/v1/images/generations",
        model: "Qwen/Qwen-Image-2.0", defaultAspectRatio: "1:1", defaultQuality: "standard",
        dailyLimit: mocks.dailyLimit, allowGuestGeneration: mocks.allowGuest,
      },
      apiKey: "sk-test-not-a-real-key",
    }
     : null)),
  resolveImageGenerationConfig: vi.fn(async () => ({
    settings: {
      enabled: mocks.enabled,
      provider: "together",
      baseUrl: "https://api.together.xyz/v1/images/generations",
      model: "Qwen/Qwen-Image-2.0",
      defaultAspectRatio: "1:1",
      defaultQuality: "standard",
      dailyLimit: mocks.dailyLimit,
      allowGuestGeneration: mocks.allowGuest,
    },
    provider: "together",
    model: "Qwen/Qwen-Image-2.0",
    endpoint: "https://api.together.xyz/v1/images/generations",
    apiKey: mocks.hasProvider ? "sk-test-not-a-real-key" : null,
    apiKeySource: mocks.hasProvider ? "admin" : null,
    capabilities: { supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true },
    aspectRatio: "1:1",
    quality: "standard",
    limits: { daily: mocks.dailyLimit, allowGuestGeneration: mocks.allowGuest },
  })),
}));

vi.mock("@/lib/image-generation/provider", () => ({
  // The capability record decides whether the official reference is attached, so
  // the mock reports it exactly as the real factory would.
  imageCapabilitiesFor: () => ({ supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true }),
  createImageProvider: () => ({
    id: "together",
    label: "Together AI",
    supportsReferenceImage: true,
    capabilities: { supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true },
    generateCabiImage: async (input: Record<string, unknown>) => {
      mocks.generated.push(input);
      if (!mocks.providerOk) return { ok: false, error: "PROVIDER_ERROR", message: "I could not draw that one just now." };
      return {
        ok: true,
        image: { bytes: new Uint8Array(256).fill(7), contentType: "image/png", provider: "together", model: "Qwen/Qwen-Image-2.0", width: 1024, height: 1024 },
      };
    },
    testConnection: async () => ({ ok: true, model: "Qwen/Qwen-Image-2.0", message: "Connected." }),
  }),
}));

vi.mock("@/lib/image-generation/storage", () => ({
  generationBucket: "cabi-generations",
  avatarBucket: "avatars",
  deleteGenerationImage: vi.fn(async (path: string) => { mocks.deletedObjects.push(path); return true; }),
  uploadGenerationImage: vi.fn(async () => ({ ok: true, path: "wallet/gen.png" })),
  signedImageUrl: vi.fn(async () => "https://storage.example.com/signed/gen.png?token=abc"),
  uploadAvatar: vi.fn(async () => ({ ok: true, path: "wallet/avatar.png" })),
  validateAvatarBytes: vi.fn(() => ({ ok: true, contentType: "image/png", extension: "png" })),
  stripJpegMetadata: vi.fn((bytes: Uint8Array) => bytes),
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserted.push({ table, ...row });
        return mocks.insertError ? { error: mocks.insertError } : { error: null };
      },
    }),
    rpc: async () => { mocks.quotaCalls += 1; return { data: [{ allowed: mocks.quotaAllowed, remaining: mocks.quotaAllowed ? 4 : 0 }], error: null }; },
  }),
}));

vi.mock("@/lib/ranking/service", () => ({
  // The "first image of the day only" rule reads this, so it must be mocked too.
  countImageXpToday: vi.fn(async () => { mocks.xpCountCalls += 1; return mocks.xpGrantedToday; }),
  /*
   * Faithful to the real rule: the bonus is granted only for the first image of
   * the day. A mock that always returned 5 could not have caught the defect
   * where the caller passed a constant instead of counting the ledger.
   */
  awardImageXp: vi.fn(async (input: { imagesRewardedToday: number }) => {
    mocks.xpAwards += 1;
    if (input.imagesRewardedToday >= mocks.imageXpPerDay) {
      return { xpAwarded: 0, seasonXp: 0, lifetimeXp: 0, tier: { tier: 1 }, previousTier: { tier: 1 }, rankedUp: false, capped: false, reasonCode: "GENERAL", label: null, seasonId: null };
    }
    return { xpAwarded: 5, seasonXp: 5, lifetimeXp: 5, tier: { tier: 1 }, previousTier: { tier: 1 }, rankedUp: false, capped: false, reasonCode: "FIRST_OF_DAY", label: "First image today", seasonId: null };
  }),
}));

vi.mock("@/lib/profiles/service", () => ({
  readProfile: vi.fn(async () => ({ profileCompletedAt: "2026-01-01T00:00:00.000Z", username: "mark" })),
}));

import { generateChatImage, isImageRequest } from "@/lib/image-generation/chat";

const wallet = { walletAccountId: "22222222-2222-2222-2222-222222222222", conversationId: null, messageId: null };

beforeEach(() => {
  mocks.enabled = true;
  mocks.allowGuest = false;
  mocks.dailyLimit = 5;
  mocks.hasProvider = true;
  mocks.quotaAllowed = true;
  mocks.providerOk = true;
  mocks.insertError = null;
  mocks.inserted = [];
  mocks.generated = [];
  mocks.deletedObjects = [];
  mocks.xpGrantedToday = 0;
  mocks.quotaCalls = 0;
  mocks.xpCountCalls = 0;
  mocks.xpAwards = 0;
  lifecycle.markGenerating.mockClear();
  lifecycle.markCompleted.mockClear();
  lifecycle.markFailed.mockClear();
  lifecycle.markGenerating.mockResolvedValue(true);
  lifecycle.markCompleted.mockResolvedValue(true);
  lifecycle.markFailed.mockResolvedValue(true);
});

describe("image request detection", () => {
  it("recognises natural requests", () => {
    for (const message of [
      "Generate a picture of you at the beach.",
      "Show me Cabi wearing a hoodie.",
      "Make an image of you gaming.",
      "Generate Cabi celebrating our rank up.",
      "Make Cabi in a cyberpunk city.",
    ]) {
      expect(isImageRequest(message)).toBe(true);
    }
  });

  it("leaves ordinary conversation alone", () => {
    for (const message of ["how are you?", "what is a bonding curve", "hi"]) {
      expect(isImageRequest(message)).toBe(false);
    }
  });

  it("does not handle a non-image message at all", async () => {
    const result = await generateChatImage("how are you today?", wallet);
    expect(result.handled).toBe(false);
  });
});

describe("scenario 6: an unrelated subject is redirected, not drawn", () => {
  it("refuses a skyscraper and offers the Cabi version without calling the provider", async () => {
    const result = await generateChatImage("Generate an image of a random skyscraper.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
    // One of several natural variants; all decline and offer the Cabi version.\n    expect(result.reply.length).toBeGreaterThan(20);\n    expect(result.reply).toMatch(/cabi/i);
    expect(JSON.stringify(result.card)).toContain("Cabi");
    expect(JSON.stringify(result.card)).toMatch(/skyscraper/i);
  });

  it("allows the Cabi version of the same request and does call the provider", async () => {
    const result = await generateChatImage("Generate Cabi on top of a skyscraper.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(true);
    expect(mocks.generated).toHaveLength(1);
  });

  it("refuses a bare car request", async () => {
    const result = await generateChatImage("Generate a Lamborghini.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(JSON.stringify(result.card).toLowerCase()).toContain("lamborghini");
  });
});

describe("application image safety", () => {
  it("refuses unsafe requests before resolving provider settings or calling the provider", async () => {
    const result = await generateChatImage("Generate an image of Cabi stabbing someone", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
    expect(result.reply).toMatch(/not draw/i);
  });
});

describe("access control", () => {
  it("blocks a guest and tells them to connect", async () => {
    const result = await generateChatImage("Generate a picture of you at the beach", { walletAccountId: null, conversationId: null, messageId: null });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(result.reply).toMatch(/Connect your wallet/i);
  });

  it("allows a guest only when the owner enabled it", async () => {
    mocks.allowGuest = true;
    const result = await generateChatImage("Generate a picture of you at the beach", { walletAccountId: null, conversationId: null, messageId: null });
    expect(result.handled && result.usedProvider).toBe(true);
  });

  it("says so when the feature is switched off", async () => {
    mocks.enabled = false;
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(result.reply).toMatch(/switched off/i);
  });

  it("still redirects an off-topic request while the feature is switched off", async () => {
    // Cabi-only enforcement is a product rule, not a feature flag. This ordering
    // was wrong once: the disabled check came first and masked the redirect, so
    // "Generate a Lamborghini" answered with a generic "it is off" instead of
    // offering the Cabi version.
    mocks.enabled = false;
    const result = await generateChatImage("Generate a Lamborghini.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    // One of several natural variants; all decline and offer the Cabi version.\n    expect(result.reply.length).toBeGreaterThan(20);\n    expect(result.reply).toMatch(/cabi/i);
    expect(JSON.stringify(result.card).toLowerCase()).toContain("lamborghini");
  });

  it("says so when no provider key is stored, without calling a provider", async () => {
    mocks.hasProvider = false;
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
  });
});

describe("quota", () => {
  it("refuses once the daily allowance is spent, before calling the provider", async () => {
    mocks.quotaAllowed = false;
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
    expect(result.reply).toMatch(/today/i);
  });

  it("generates while allowance remains", async () => {
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled && result.usedProvider).toBe(true);
  });
});

describe("provider failure", () => {
  it("reports honestly and records the attempt as FAILED", async () => {
    mocks.providerOk = false;
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(true);
    // Failure is a transition on the row that was already QUEUED, so the
    // lifecycle has one row moving through states rather than two rows.
    expect(lifecycle.markFailed).toHaveBeenCalledWith(expect.objectContaining({ code: "PROVIDER_ERROR" }));
    expect(result.reply).toMatch(/Ohhh, I couldn't make that image/i);
    expect(result.reply).toMatch(/different idea|simplify the scene|fewer little details/i);
    expect((result.card as Record<string, unknown>).message).not.toContain("I could not draw that one just now");
    expect((result.card as Record<string, unknown>).retry).toMatchObject({ label: "Try Again", prompt: "Generate a picture of you at the beach" });
    const queued = mocks.inserted.filter((row) => row.status === "QUEUED");
    expect(queued).toHaveLength(1);
    expect(mocks.inserted.every((row) => row.wallet_account_id === wallet.walletAccountId)).toBe(true);
    expect((result.card as Record<string, unknown>).debugDetails).toBeUndefined();
  });

  it("keeps diagnostics out of owner-preview chat and links the owner to Admin", async () => {
    mocks.providerOk = false;
    const result = await generateChatImage("Generate a picture of you at the beach", { ...wallet, ownerPreview: true });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.card).not.toHaveProperty("debugDetails");
    expect(result.card.links).toContainEqual({ label: "View in Admin", url: "/admin/images#recent-generation-runs", kind: "INTERNAL" });
    expect(JSON.stringify(result.card)).not.toMatch(/requestId|wallet|provider|model|httpStatus|latency|UNSAFE_PROMPT/u);
  });

  it("stops before the paid provider request when the generation row insert fails", async () => {
    mocks.insertError = { code: "42703", message: "column \"reference_conditioned\" does not exist" };
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
    expect(lifecycle.markGenerating).not.toHaveBeenCalled();
    expect(result.card).toMatchObject({ title: "A tiny image hiccup", message: "Want to retry, try a different idea, or simplify the scene with fewer details?", retry: { label: "Try Again" } });
  });

  it("stops before the paid provider request when QUEUED-to-GENERATING fails", async () => {
    lifecycle.markGenerating.mockResolvedValue(false);
    const result = await generateChatImage("Generate a picture of you at the beach", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(false);
    expect(mocks.generated).toHaveLength(0);
  });
});

describe("successful generation", () => {
  it("returns an image card with the user's own prompt and a signed link", async () => {
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    const card = result.card as Record<string, unknown>;
    expect(card.kind).toBe("IMAGE");
    expect(String(card.prompt)).toContain("coffee");
    expect(String(card.url)).toMatch(/^https:\/\//);
    // The internal character specification must never appear in a card.
    expect(JSON.stringify(card)).not.toContain("CABI_CHARACTER_BIBLE");
    expect(JSON.stringify(card)).not.toContain("ash-gray");
  });

  it("stores the sanitised user prompt, never the internal prompt", async () => {
    await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    // The prompt is stored when the row is QUEUED, and the same row is then
    // completed, so the sanitised scene is what persists.
    const queued = mocks.inserted.find((row) => row.status === "QUEUED");
    expect(queued).toBeDefined();
    expect(String(queued?.user_prompt)).toContain("coffee");
    expect(String(queued?.user_prompt)).not.toContain("ash-gray");
    expect(lifecycle.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("queues every current-schema field before provider spend and persists a storage path on completion", async () => {
    await generateChatImage("Generate a picture of you drinking coffee.", {
      ...wallet,
      conversationId: "33333333-3333-4333-8333-333333333333",
      messageId: "44444444-4444-4444-8444-444444444444",
    });
    const queued = mocks.inserted.find((row) => row.table === "image_generations" && row.status === "QUEUED");
    expect(queued).toMatchObject({
      wallet_account_id: wallet.walletAccountId,
      conversation_id: "33333333-3333-4333-8333-333333333333",
      message_id: "44444444-4444-4444-8444-444444444444",
      reference_conditioned: expect.any(Boolean),
      status: "QUEUED",
    });
    expect(queued).toHaveProperty("pipeline_request_id");
    expect(queued).toHaveProperty("diagnostic_stage");
    expect(lifecycle.markGenerating.mock.invocationCallOrder[0]).toBeLessThan(lifecycle.markCompleted.mock.invocationCallOrder[0]);
    expect(lifecycle.markCompleted).toHaveBeenCalledWith(expect.objectContaining({ imagePath: "wallet/gen.png", diagnostics: expect.objectContaining({ pipeline_request_id: expect.any(String) }) }));
  });

  it("keeps the admin full-chat test out of user quota and XP accounting", async () => {
    await generateChatImage("Generate a picture of you drinking coffee.", { ...wallet, adminPipelineTest: true, ownerPreview: true });
    expect(mocks.quotaCalls).toBe(0);
    expect(mocks.xpCountCalls).toBe(0);
    expect(mocks.xpAwards).toBe(0);
  });

  it("does not return an image card if the completion update fails, and cleans up the upload", async () => {
    lifecycle.markCompleted.mockResolvedValue(false);
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.usedProvider).toBe(true);
    expect(result.card.kind).toBe("NOTICE");
    expect(mocks.deletedObjects).toEqual(["wallet/gen.png"]);
    expect(lifecycle.markFailed).toHaveBeenCalledWith(expect.objectContaining({ code: "DATABASE_UPDATE_FAILED" }));
  });

  it("offers the avatar option only because the profile is complete", async () => {
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    if (!result.handled) return;
    expect((result.card as Record<string, unknown>).canUseAsAvatar).toBe(true);
  });

  it("does not expose an API key anywhere in the result", async () => {
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    expect(JSON.stringify(result)).not.toContain("sk-test-not-a-real-key");
  });
});

describe("image xp is not farmable", () => {
  it("awards the bonus for the first image of the day", async () => {
    mocks.xpGrantedToday = 0;
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect((result.card as Record<string, unknown>).xp).toBe(5);
  });

  it("awards nothing for a repeat generation the same day", async () => {
    // The counter is read from the XP ledger. Passing a constant here was a real
    // defect: it made a paid API a repeatable XP source.
    mocks.xpGrantedToday = 1;
    const result = await generateChatImage("Generate a picture of you drinking coffee.", wallet);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect((result.card as Record<string, unknown>).xp).toBeNull();
  });
});

describe("card shape", () => {
  it("rejects a non-HTTPS image URL rather than rendering it", async () => {
    const { imageCard } = await import("@/lib/actions/cards");
    const card = imageCard({
      generationId: "g1", url: "javascript:alert(1)", prompt: "x", aspectRatio: "1:1",
      createdAt: "2026-01-01T00:00:00.000Z", canUseAsAvatar: false,
    });
    expect(card.url).toBe("");
  });

  it("carries no price or valuation field", async () => {
    const { imageCard } = await import("@/lib/actions/cards");
    const card = imageCard({
      generationId: "g1", url: "https://storage.example.com/a.png", prompt: "cabi", aspectRatio: "1:1",
      createdAt: "2026-01-01T00:00:00.000Z", canUseAsAvatar: false,
    });
    const serialized = JSON.stringify(card).toLowerCase();
    for (const banned of ["usd", "price", "marketcap", "holders"]) expect(serialized).not.toContain(banned);
  });
});

describe("guard accepts the stored image card", () => {
  it("round-trips an image card through validation", async () => {
    const { imageCard } = await import("@/lib/actions/cards");
    const { parseActionCard } = await import("@/lib/actions/guards");
    const card = imageCard({
      generationId: "g1", url: "https://storage.example.com/a.png", prompt: "cabi at the beach",
      aspectRatio: "1:1", createdAt: "2026-01-01T00:00:00.000Z", canUseAsAvatar: true, xp: 5, initials: "MA",
    });
    expect(parseActionCard(card)).not.toBeNull();
  });

  it("rejects a tampered image card with a data URL", async () => {
    const { imageCard } = await import("@/lib/actions/cards");
    const { parseActionCard } = await import("@/lib/actions/guards");
    const card = imageCard({
      generationId: "g1", url: "https://storage.example.com/a.png", prompt: "cabi",
      aspectRatio: "1:1", createdAt: "2026-01-01T00:00:00.000Z", canUseAsAvatar: false,
    });
    expect(parseActionCard({ ...card, url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).toBeNull();
  });
});
