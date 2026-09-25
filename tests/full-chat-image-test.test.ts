import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  generatedCalls: [] as Array<{ prompt: string; options: Record<string, unknown> }>,
  generatedCard: {
    kind: "IMAGE",
    id: "image-card",
    title: "Cabi",
    rows: [],
    links: [],
    generationId: "generation-test",
    url: "https://storage.test/signed/temp",
    prompt: "Please generate the cutest image of you.",
    aspectRatio: "1:1",
    createdAt: "2026-09-25T00:00:00.000Z",
    canUseAsAvatar: false,
    xp: null,
  },
  databaseAvailable: true,
  profileMatches: true,
  assistantInsertFails: false,
  generationCreated: false,
  assistantId: "assistant-message",
  writes: [] as Array<{ table: string; operation: string; value: unknown }>,
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => {
    if (!mocks.databaseAvailable) return null;
    return {
      from: (table: string) => {
        let operation = "select";
        let value: Record<string, unknown> | null = null;
        const filters = new Map<string, unknown>();
        const query: Record<string, unknown> = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn((key: string, next: unknown) => { filters.set(key, next); return query; });
        query.insert = vi.fn((next: Record<string, unknown>) => {
          operation = "insert";
          value = next;
          mocks.writes.push({ table, operation, value });
          if (table === "conversations") mocks.events.push("conversation_insert");
          if (table === "messages") {
            mocks.events.push(next.role === "user" ? "user_message_insert" : "assistant_message_insert");
            if (next.role === "assistant" && typeof next.id === "string") mocks.assistantId = next.id;
          }
          return query;
        });
        query.update = vi.fn((next: Record<string, unknown>) => {
          operation = "update";
          value = next;
          mocks.writes.push({ table, operation, value });
          return query;
        });
        query.delete = vi.fn(() => {
          operation = "delete";
          mocks.events.push(table === "image_generations" ? "generation_delete" : "conversation_delete");
          mocks.writes.push({ table, operation, value: null });
          return query;
        });
        query.single = vi.fn(async () => ({
          data: mocks.assistantInsertFails && table === "messages" && value?.role === "assistant"
            ? null
            : { id: value?.id ?? `${table}-id` },
          error: mocks.assistantInsertFails && table === "messages" && value?.role === "assistant" ? { code: "23514", message: "message insert failed" } : null,
        }));
        query.maybeSingle = vi.fn(async () => {
          if (table === "profiles") return { data: mocks.profileMatches ? { id: "profile-owner" } : null, error: null };
          if (table === "image_generations") {
            if (operation === "select") return { data: mocks.generationCreated ? { id: "generation-test", image_path: "wallet-owner/generation-test.png", status: "COMPLETED", assistant_message_id: mocks.assistantId } : null, error: null };
            if (operation === "delete" || operation === "update") return { data: { id: "generation-test" }, error: null };
          }
          if (table === "messages" && operation === "select") return {
            data: { id: mocks.assistantId, role: "assistant", content: "Here you go.", status: "complete", metadata_json: { actionCard: { ...mocks.generatedCard, url: "" } } },
            error: null,
          };
          if (table === "conversations" && operation === "delete") return { data: { id: "conversation-test" }, error: null };
          return { data: { id: value?.id ?? `${table}-id` }, error: null };
        });
        query.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
        return query;
      },
    };
  },
}));
vi.mock("@/lib/image-generation/chat", () => ({
  generateChatImage: vi.fn(async (prompt: string, options: Record<string, unknown>) => {
    mocks.events.push("chat_generate");
    mocks.generationCreated = true;
    mocks.generatedCalls.push({ prompt, options });
    const trace = options.trace as { record: (stage: string) => void };
    for (const stage of [
      "IMAGE_CONFIG_RESOLVED", "QUOTA_CHECK_PASSED", "CABI_REFERENCE_RESOLVED", "PROMPT_BUILT",
      "GENERATION_ROW_CREATED", "GENERATION_ROW_UPDATED", "TOGETHER_REQUEST_STARTED",
      "TOGETHER_RESPONSE_RECEIVED", "PROVIDER_IMAGE_FETCHED", "SUPABASE_UPLOAD_STARTED",
      "SUPABASE_UPLOAD_COMPLETED", "GENERATION_ROW_UPDATED",
    ]) trace.record(stage);
    return { handled: true, usedProvider: true, reply: "Here you go.", card: { ...mocks.generatedCard } };
  }),
}));
vi.mock("@/lib/image-generation/lifecycle", () => ({
  persistChatImageAttachment: vi.fn(async () => { mocks.events.push("message_attachment"); return true; }),
  refreshStoredCards: vi.fn(async (messages: Array<Record<string, unknown>>) => {
    const [message] = messages;
    const metadata = message.metadata_json as Record<string, unknown>;
    const card = metadata.actionCard as Record<string, unknown>;
    return [{ ...message, metadata_json: { ...metadata, actionCard: { ...card, url: "https://storage.test/signed/fresh" } } }];
  }),
}));
vi.mock("@/lib/image-generation/storage", () => ({ deleteGenerationImage: vi.fn(async () => { mocks.events.push("object_remove"); return true; }) }));
vi.mock("@/lib/image-generation/diagnostics", () => ({ persistImageDatabaseFailure: vi.fn(async () => undefined) }));

import { runFullChatImageTest } from "@/lib/image-generation/full-chat-test";

beforeEach(() => {
  mocks.events = [];
  mocks.generatedCalls = [];
  mocks.databaseAvailable = true;
  mocks.profileMatches = true;
  mocks.assistantInsertFails = false;
  mocks.generationCreated = false;
  mocks.assistantId = "assistant-message";
  mocks.writes = [];
});

describe("full chat image pipeline admin test", () => {
  it("uses the signed-in wallet identity, checks read-back, and cleans all temporary rows and storage", async () => {
    const result = await runFullChatImageTest({ walletAccountId: "wallet-owner", profileId: "profile-owner" });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      { label: "Wallet Identity", state: "PASS" },
      { label: "Configuration", state: "PASS" },
      { label: "Database Insert", state: "PASS" },
      { label: "API Key", state: "PASS" },
      { label: "Together", state: "PASS" },
      { label: "Image Download", state: "PASS" },
      { label: "Storage", state: "PASS" },
      { label: "Database Update", state: "PASS" },
      { label: "Message Attachment", state: "PASS" },
      { label: "Message Persistence", state: "PASS" },
      { label: "Read Back", state: "PASS" },
      { label: "Cleanup", state: "PASS" },
    ]));
    expect(mocks.generatedCalls[0]).toMatchObject({
      prompt: "Please generate the cutest image of you.",
      options: { walletAccountId: "wallet-owner", adminPipelineTest: true, ownerPreview: true },
    });
    expect(mocks.events.indexOf("assistant_message_insert")).toBeLessThan(mocks.events.indexOf("chat_generate"));
    expect(mocks.events.indexOf("object_remove")).toBeLessThan(mocks.events.indexOf("generation_delete"));
    expect(mocks.events.indexOf("generation_delete")).toBeLessThan(mocks.events.indexOf("conversation_delete"));
  });

  it("stops before Together and cleans up when the temporary assistant row cannot be created", async () => {
    mocks.assistantInsertFails = true;
    const result = await runFullChatImageTest({ walletAccountId: "wallet-owner", profileId: "profile-owner" });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.label === "Cleanup")?.state).toBe("PASS");
    expect(mocks.generatedCalls).toHaveLength(0);
    expect(mocks.events).toContain("conversation_delete");
  });
});
