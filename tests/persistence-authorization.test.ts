import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  walletGuard: vi.fn(),
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceClient: mocks.database }));
vi.mock("@/lib/wallet/session", () => ({ walletAuthOrResponse: mocks.walletGuard }));
vi.mock("@/lib/site/guard", () => ({ guardAppApi: vi.fn(async () => null) }));

import { GET as listConversations } from "@/app/api/conversations/route";
import { DELETE as deleteConversation, GET as getConversation } from "@/app/api/conversations/[id]/route";
import { POST as importGuestConversation } from "@/app/api/conversations/import-guest/route";
import { DELETE as deleteMemory } from "@/app/api/memories/[id]/route";
import { listMemories } from "@/lib/memory/store";

const walletA = {
  sessionId: "session-a",
  walletAccountId: "wallet-a",
  profileId: "profile-a",
  walletAddress: "0x00000000000000000000000000000000000000A1",
  walletAddressUniqueKey: "0x00000000000000000000000000000000000000a1",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function authenticatedAsWalletA() {
  mocks.walletGuard.mockResolvedValue({ identity: walletA, response: null });
}

function notFoundDatabase() {
  const eqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "delete", "update"]) chain[method] = vi.fn(() => chain);
  chain.eq = vi.fn((field: string, value: unknown) => { eqCalls.push([field, value]); return chain; });
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const db = { from: vi.fn(() => chain) };
  mocks.database.mockReturnValue(db);
  return { db, eqCalls };
}

describe("wallet persistence authorization", () => {
  beforeEach(() => {
    mocks.database.mockReset();
    mocks.walletGuard.mockReset();
    mocks.walletGuard.mockResolvedValue({
      identity: null,
      response: Response.json({ error: "Connect and sign in with your wallet to continue.", code: "WALLET_UNAUTHORIZED" }, { status: 401 }),
    });
  });

  it("denies a guest conversation-history read before creating a database client", async () => {
    const response = await listConversations(new Request("http://localhost:5173/api/conversations"));
    expect(response.status).toBe(401);
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("denies guest-chat migration before parsing or writing the transcript", async () => {
    const response = await importGuestConversation(new Request("http://localhost:5173/api/conversations/import-guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "temporary" }] }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("wallet A cannot fetch wallet B's conversation", async () => {
    authenticatedAsWalletA();
    const { db, eqCalls } = notFoundDatabase();
    const response = await getConversation(
      new Request("http://localhost:5173/api/conversations/chat-b"),
      { params: Promise.resolve({ id: "chat-b" }) },
    );
    expect(response.status).toBe(404);
    expect(db.from).toHaveBeenCalledWith("conversations");
    expect(eqCalls).toEqual(expect.arrayContaining([["id", "chat-b"], ["wallet_account_id", "wallet-a"]]));
  });

  it("wallet A cannot delete wallet B's conversation", async () => {
    authenticatedAsWalletA();
    const { eqCalls } = notFoundDatabase();
    const response = await deleteConversation(
      new Request("http://localhost:5173/api/conversations/chat-b", { method: "DELETE" }),
      { params: Promise.resolve({ id: "chat-b" }) },
    );
    expect(response.status).toBe(404);
    expect(eqCalls).toEqual(expect.arrayContaining([["id", "chat-b"], ["wallet_account_id", "wallet-a"]]));
  });

  it("wallet A cannot delete wallet B's memory", async () => {
    authenticatedAsWalletA();
    const { eqCalls } = notFoundDatabase();
    const response = await deleteMemory(
      new Request("http://localhost:5173/api/memories/memory-b", { method: "DELETE" }),
      { params: Promise.resolve({ id: "memory-b" }) },
    );
    expect(response.status).toBe(404);
    expect(eqCalls).toEqual(expect.arrayContaining([["id", "memory-b"], ["wallet_account_id", "wallet-a"]]));
  });

  it("scopes every memory-history read to the authenticated wallet", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((field: string, value: unknown) => { eqCalls.push([field, value]); return chain; });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: [], error: null }));
    mocks.database.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(listMemories("wallet-a", 20)).resolves.toEqual([]);
    expect(eqCalls).toContainEqual(["wallet_account_id", "wallet-a"]);
  });
});
