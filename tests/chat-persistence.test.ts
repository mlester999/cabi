import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  wallet: vi.fn(),
  writes: [] as Array<{ table: string; operation: string; value: unknown }>,
  imageCalls: [] as Array<{ message: string; options: unknown }>,
  modelCalls: 0,
  previewActive: false,
  imageMode: "notice" as "notice" | "image",
}));

vi.mock("@/lib/ai/config", () => ({ getProviderConfig: vi.fn(async () => ({
  apiKey: "test-key", baseUrl: "https://api.deepseek.com", model: "test-model", wireApi: "chat-completions",
  temperature: 0.5, maxOutputTokens: 100, timeoutMs: 5_000, retryCount: 0,
})) }));
vi.mock("@/lib/ai/deepseek", () => ({ DeepSeekProvider: class {
  async *stream() { mocks.modelCalls += 1; yield { type: "text-delta", text: "Hi from Cabi" }; yield { type: "usage", usage: { input: 2, output: 3, total: 5 } }; }
  async generate() { return { text: "summary", model: "test-model" }; }
} }));
vi.mock("@/lib/image-generation/chat", () => ({
  isImageRequest: (message: string) => message.startsWith("Generate an image"),
  generateChatImage: vi.fn(async (message: string, options: unknown) => {
    if (!message.startsWith("Generate an image")) return { handled: false as const };
    mocks.imageCalls.push({ message, options });
    const ownerPreview = Boolean((options as { ownerPreview?: boolean }).ownerPreview);
    const imageCard = {
      kind: "IMAGE" as const,
      id: "image-card",
      title: "Cabi image",
      rows: [],
      links: [],
      generationId: "33333333-3333-4333-8333-333333333333",
      url: "https://storage.example.com/signed/gen.png",
      prompt: message,
      aspectRatio: "1:1",
      createdAt: "2026-01-01T00:00:00.000Z",
      canUseAsAvatar: false,
      xp: null,
    };
    if (mocks.imageMode === "image") return { handled: true as const, usedProvider: true, reply: "Here you go.", card: imageCard };
    return {
      handled: true as const,
      usedProvider: true,
      reply: "",
      card: {
        kind: "NOTICE",
        id: "notice-image-failure",
        title: "I could not draw that one",
        rows: [],
        links: [],
        tone: "error",
        message: "I couldn't make that image right now.",
        retry: { label: "Try Again", prompt: message },
        ...(ownerPreview ? { links: [{ label: "View in Admin", url: "/admin/images#recent-generation-runs", kind: "INTERNAL" }] } : {}),
      },
    };
  }),
}));
vi.mock("@/lib/bond", () => ({
  bondFromPoints: vi.fn(() => ({ level: 1, label: "New friend", progress: 0, points: 0 })),
  recordConversationBond: vi.fn(async () => ({ level: 1, label: "New friend", progress: 5, points: 3 })),
}));
vi.mock("@/lib/config/runtime", () => ({ getCabiRuntimeConfig: vi.fn(async () => ({
  personality: null,
  cpu: { tokenName: "Cat Partner Unit", ticker: "CPU", launchStatus: "PRELAUNCH" },
  publicWallet: { chains: [], primaryChainId: null, cpu: {} },
})) }));
vi.mock("@/lib/db/supabase", () => ({ getServiceClient: mocks.database }));
vi.mock("@/lib/knowledge/rag", () => ({ retrieveRagContext: vi.fn(async () => ({ records: [], sources: [] })) }));
vi.mock("@/lib/memory/context", () => ({ getConversationContext: vi.fn(async () => ({ recent: [], summary: null, memories: [], nickname: null, memoryEnabled: true })) }));
vi.mock("@/lib/memory/store", () => ({ applyMemoryIntent: vi.fn(async () => ({ type: "none" })) }));
vi.mock("@/lib/memory/summarizer", () => ({ maybeSummarizeConversation: vi.fn(async () => false) }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })) }));
// The route now enforces the site mode and the $CPU holder gate; both are
// covered by their own suites, so this one focuses on the persistence boundary.
vi.mock("@/lib/site/guard", () => ({ guardAppApi: vi.fn(async () => null), guardAppApiCpu: vi.fn(async () => null) }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: vi.fn(async () => mocks.previewActive) }));
vi.mock("@/lib/site/owner-preview", () => ({ readOwnerPreviewAuth: vi.fn(async () => null) }));
vi.mock("@/lib/wallet/session", () => ({ readWalletAuth: mocks.wallet }));

import { POST as chat } from "@/app/api/chat/route";

function databaseDouble(options: {
  assistantInsertFails?: boolean;
  assistantCompletionFails?: boolean;
  retryConversationId?: string;
  retryMessageId?: string;
  originalUserId?: string;
  originalUserContent?: string;
} = {}) {
  let messageInsertCount = 0;
  const db = {
    from: vi.fn((table: string) => {
      let written: unknown;
      let operation = "";
      let selected = "";
      const filters = new Map<string, unknown>();
      const query: Record<string, unknown> = {};
      query.select = vi.fn((value: string) => { selected = value; return query; });
      query.eq = vi.fn((column: string, value: unknown) => { filters.set(column, value); return query; });
      query.lt = vi.fn((column: string, value: unknown) => { filters.set(`lt:${column}`, value); return query; });
      for (const method of ["in", "neq", "order", "limit", "gt"]) query[method] = vi.fn(() => query);
      query.insert = vi.fn((value: unknown) => {
        operation = "insert";
        written = value;
        if (table === "messages") messageInsertCount += 1;
        mocks.writes.push({ table, operation: "insert", value });
        return query;
      });
      query.update = vi.fn((value: unknown) => {
        operation = "update";
        written = value;
        mocks.writes.push({ table, operation: "update", value });
        return query;
      });
      query.delete = vi.fn(() => {
        operation = "delete";
        mocks.writes.push({ table, operation: "delete", value: null });
        return query;
      });
      query.single = vi.fn(async () => ({
        data: options.assistantInsertFails && table === "messages" && messageInsertCount === 2
          ? null
          : { id: typeof written === "object" && written && "id" in written ? (written as { id: string }).id : `${table}-id` },
        error: options.assistantInsertFails && table === "messages" && messageInsertCount === 2 ? { code: "write_failed" } : null,
      }));
      query.maybeSingle = vi.fn(async () => {
        if (table === "conversations" && filters.get("id") === options.retryConversationId) {
          return { data: { id: options.retryConversationId }, error: null };
        }
        if (table === "messages" && selected === "id,role,created_at" && filters.get("id") === options.retryMessageId) {
          return { data: { id: options.retryMessageId, role: "assistant", created_at: "2026-02-01T00:00:01.000Z" }, error: null };
        }
        if (table === "messages" && selected === "id,content" && filters.get("role") === "user" && filters.has("lt:created_at")) {
          return { data: { id: options.originalUserId, content: options.originalUserContent }, error: null };
        }
        return { data: null, error: null };
      });
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: options.assistantCompletionFails && table === "messages" && operation === "update" ? { code: "write_failed" } : null,
        }).then(resolve, reject);
      return query;
    }),
  };
  return db;
}

function request(persist: boolean, message = "Hello Cabi", extra: Record<string, unknown> = {}) {
  return new Request("http://localhost:5173/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, persist, clientRequestId: "cf2ad16e-6cd2-4fb2-830a-4759ac8d963f", guestHistory: [], ...extra }),
  });
}

describe("chat persistence boundary", () => {
  beforeEach(() => {
    mocks.database.mockReset();
    mocks.wallet.mockReset();
    mocks.writes.length = 0;
    mocks.imageCalls.length = 0;
    mocks.modelCalls = 0;
    mocks.previewActive = false;
    mocks.imageMode = "notice";
  });

  it("does not create a database client or write messages for a guest", async () => {
    mocks.wallet.mockResolvedValue(null);
    const response = await chat(request(true));
    await response.text();
    expect(response.status).toBe(200);
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it("persists the conversation and both messages for an authenticated wallet", async () => {
    mocks.wallet.mockResolvedValue({
      walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1",
    });
    mocks.database.mockReturnValue(databaseDouble());
    const response = await chat(request(true));
    await response.text();
    expect(response.status).toBe(200);
    expect(mocks.writes.filter((write) => write.table === "conversations" && write.operation === "insert")).toHaveLength(1);
    expect(mocks.writes.filter((write) => write.table === "messages" && write.operation === "insert")).toHaveLength(2);
  });

  it("persists an image failure card without calling the chat model or duplicating its empty reply", async () => {
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    mocks.database.mockReturnValue(databaseDouble());
    const response = await chat(request(true, "Generate an image of you at the beach"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.modelCalls).toBe(0);
    expect(body).toContain("event: action");
    expect(body).not.toContain("event: delta");
    const assistantUpdate = mocks.writes.find((write) => write.table === "messages" && write.operation === "update" && typeof write.value === "object" && write.value !== null && "metadata_json" in write.value) as { value?: { content?: string; metadata_json?: { actionCard?: { retry?: unknown; debugDetails?: unknown } } } } | undefined;
    expect(assistantUpdate?.value?.content).toBe("");
    expect(assistantUpdate?.value?.metadata_json?.actionCard?.retry).toBeDefined();
    expect(assistantUpdate?.value?.metadata_json?.actionCard?.debugDetails).toBeUndefined();
  });

  it("reuses the original user message when retrying an assistant response", async () => {
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    const retryConversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const retryMessageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mocks.database.mockReturnValue(databaseDouble({
      retryConversationId,
      retryMessageId,
      originalUserId: "user-original",
      originalUserContent: "Generate an image of Cabi",
    }));
    const response = await chat(request(true, "Generate an image of Cabi", {
      conversationId: retryConversationId,
      retryOfMessageId: retryMessageId,
    }));
    await response.text();
    expect(response.status).toBe(200);
    const messageInserts = mocks.writes.filter((write) => write.table === "messages" && write.operation === "insert");
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0].value).toMatchObject({ role: "assistant", retry_of_message_id: retryMessageId });
    expect(mocks.imageCalls[0]?.options).toMatchObject({ messageId: "user-original" });
  });

  it("keeps owner-preview diagnostics out of chat and points to Admin", async () => {
    mocks.previewActive = true;
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    mocks.database.mockReturnValue(databaseDouble());
    const response = await chat(request(true, "Generate an image of you at the beach"));
    const body = await response.text();
    expect(body).toContain("View in Admin");
    expect(body).not.toContain("owner-preview-trace");
    const assistantUpdate = mocks.writes.find((write) => write.table === "messages" && write.operation === "update" && typeof write.value === "object" && write.value !== null && "metadata_json" in write.value) as { value?: { metadata_json?: { actionCard?: Record<string, unknown> } } } | undefined;
    expect(assistantUpdate?.value?.metadata_json?.actionCard).not.toHaveProperty("debugDetails");
  });

  it("downgrades to the friendly failure card when the durable generation/message link fails", async () => {
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    mocks.database.mockReturnValue(databaseDouble());
    mocks.imageMode = "image";
    const response = await chat(request(true, "Generate an image of Cabi"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Couldn't make that image.");
    expect(body).not.toContain("https://storage.example.com/signed/gen.png");
    const generationLink = mocks.writes.find((write) => write.table === "image_generations" && write.operation === "update");
    expect(generationLink?.value).toEqual({ assistant_message_id: expect.any(String) });
    const assistantUpdate = mocks.writes.find((write) => write.table === "messages" && write.operation === "update" && typeof write.value === "object" && write.value !== null && "metadata_json" in write.value) as { value?: { metadata_json?: { actionCard?: { kind?: string; title?: string } } } } | undefined;
    expect(assistantUpdate?.value?.metadata_json?.actionCard).toMatchObject({ kind: "NOTICE", title: "Couldn't make that image." });
  });

  it("returns 503 instead of silently downgrading when wallet authentication storage fails", async () => {
    mocks.wallet.mockRejectedValue(new Error("WALLET_AUTH_DATABASE_ERROR:find_session:unavailable"));
    const response = await chat(request(true));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "WALLET_AUTH_UNAVAILABLE" });
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("returns 503 when the assistant reply row cannot be created", async () => {
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    mocks.database.mockReturnValue(databaseDouble({ assistantInsertFails: true }));
    const response = await chat(request(true));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "MESSAGE_SAVE_FAILED" });
    expect(mocks.writes.some((write) => write.operation === "delete")).toBe(true);
  });

  it("never emits a persistent done event when final reply storage fails", async () => {
    mocks.wallet.mockResolvedValue({ walletAccountId: "wallet-a", profileId: "profile-a", walletAddress: "0x00000000000000000000000000000000000000A1" });
    mocks.database.mockReturnValue(databaseDouble({ assistantCompletionFails: true }));
    const response = await chat(request(true));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: done");
  });
});
