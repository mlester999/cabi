import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generations: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ table: string; operation: string; value: unknown; filters: Array<[string, unknown]> }>,
  signedPaths: [] as string[],
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let operation = "select";
      let value: unknown;
      const query: Record<string, unknown> = {};
      const rows = () => table === "image_generations" ? mocks.generations : mocks.messages;
      const match = (row: Record<string, unknown>) => filters.every(([key, expected]) => {
        if (key.startsWith("in:")) return (expected as unknown[]).includes(row[key.slice(3)]);
        return row[key] === expected;
      });
      const execute = () => {
        mocks.writes.push({ table, operation, value, filters: [...filters] });
        const found = rows().filter(match);
        if (operation === "update" && found[0] && value && typeof value === "object") Object.assign(found[0], value);
        return { data: found[0] ?? null, error: null };
      };
      query.select = vi.fn(() => query);
      query.eq = vi.fn((key: string, expected: unknown) => { filters.push([key, expected]); return query; });
      query.in = vi.fn((key: string, expected: unknown[]) => { filters.push([`in:${key}`, expected]); return query; });
      query.update = vi.fn((next: unknown) => { operation = "update"; value = next; return query; });
      query.maybeSingle = vi.fn(async () => execute());
      query.then = (resolve: (result: unknown) => unknown) => {
        mocks.writes.push({ table, operation, value, filters: [...filters] });
        return Promise.resolve({ data: rows().filter(match), error: null }).then(resolve);
      };
      return query;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          mocks.signedPaths.push(path);
          return { data: { signedUrl: `https://storage.example.test/signed/${encodeURIComponent(path)}?fresh=1` }, error: null };
        },
      }),
    },
  }),
}));

import { imageCard } from "@/lib/actions/cards";
import { persistChatImageAttachment, refreshStoredCards } from "@/lib/image-generation/lifecycle";

const walletA = "wallet-a";
const walletB = "wallet-b";
const conversationId = "conversation-a";
const messageId = "assistant-a";
const generationId = "generation-a";

beforeEach(() => {
  mocks.generations = [{
    id: generationId,
    wallet_account_id: walletA,
    conversation_id: conversationId,
    message_id: "user-a",
    assistant_message_id: null,
    status: "COMPLETED",
    user_prompt: "Cabi drinking coffee",
    aspect_ratio: "1:1",
    image_path: "wallet-a/generation-a.png",
    created_at: "2026-09-25T00:00:00.000Z",
    queued_at: null,
    started_at: null,
    completed_at: "2026-09-25T00:00:00.000Z",
    failed_at: null,
    failure_message: null,
    parent_generation_id: null,
  }];
  mocks.messages = [{ id: messageId, conversation_id: conversationId, role: "assistant", content: "", status: "streaming", metadata_json: {} }];
  mocks.writes = [];
  mocks.signedPaths = [];
});

describe("durable chat image attachment", () => {
  it("links a wallet-owned completed generation and persists no temporary signed URL", async () => {
    const card = imageCard({
      generationId,
      url: "https://storage.example.test/signed/temporary?token=expired",
      prompt: "Cabi drinking coffee",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: false,
    });
    const saved = await persistChatImageAttachment({
      walletAccountId: walletA,
      conversationId,
      assistantMessageId: messageId,
      generationId,
      card,
      content: "Here you go.",
      metadata: { mood: "cozy" },
    });

    expect(saved).toBe(true);
    expect(mocks.generations[0]).toMatchObject({ assistant_message_id: messageId, wallet_account_id: walletA });
    const messageWrite = mocks.writes.find((write) => write.table === "messages" && write.operation === "update");
    expect(messageWrite?.value).toMatchObject({
      content: "Here you go.",
      status: "complete",
      metadata_json: { mood: "cozy", actionCard: { kind: "IMAGE", generationId, url: "" } },
    });
    expect(JSON.stringify(messageWrite?.value)).not.toContain("temporary?token");
    expect(mocks.writes.find((write) => write.table === "image_generations" && write.operation === "update")?.filters)
      .toContainEqual(["wallet_account_id", walletA]);
  });

  it("reopens the image using a fresh signed URL derived from its private path", async () => {
    mocks.generations[0].assistant_message_id = messageId;
    const card = imageCard({
      generationId,
      url: "",
      prompt: "Cabi drinking coffee",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: false,
    });
    const message = { id: messageId, role: "assistant", content: "Here you go.", status: "complete", metadata_json: { actionCard: card } };
    const [reopened] = await refreshStoredCards([message], walletA);
    const stored = (reopened.metadata_json as { actionCard: { url: string } }).actionCard;

    expect(stored.url).toContain("fresh=1");
    expect(mocks.signedPaths).toEqual(["wallet-a/generation-a.png"]);
    const read = mocks.writes.find((write) => write.table === "image_generations" && write.operation === "select");
    expect(read?.filters).toContainEqual(["wallet_account_id", walletA]);
  });

  it("does not sign a generation belonging to another wallet", async () => {
    mocks.generations[0].assistant_message_id = messageId;
    const card = imageCard({
      generationId,
      url: "https://storage.example.test/signed/old",
      prompt: "Cabi drinking coffee",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: false,
    });
    const message = { id: messageId, role: "assistant", content: "Here you go.", status: "complete", metadata_json: { actionCard: card } };
    const [reopened] = await refreshStoredCards([message], walletB);

    expect(mocks.signedPaths).toEqual([]);
    expect(reopened.metadata_json).not.toHaveProperty("actionCard");
  });
});
