import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  audit: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({ adminOrResponse: mocks.admin }));
vi.mock("@/lib/admin/audit", () => ({ auditAdmin: mocks.audit }));
vi.mock("@/lib/site/owner-wallets", () => ({ listOwnerWallets: mocks.list, saveOwnerWallet: mocks.save, disableOwnerWallet: mocks.disable }));

import { DELETE, GET, POST } from "@/app/api/admin/owner-wallets/route";

const address = "0x00000000000000000000000000000000000000A1";

function request(method: "POST" | "DELETE", body: unknown, origin = "http://localhost:5173") {
  return new Request("http://localhost:5173/api/admin/owner-wallets", {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("admin owner-wallet management", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.admin.mockResolvedValue({ session: { email: "owner@example.test" }, response: null });
    mocks.list.mockResolvedValue([]);
    mocks.save.mockResolvedValue([]);
    mocks.disable.mockResolvedValue([]);
    mocks.audit.mockResolvedValue(undefined);
  });

  it("requires the existing password-admin session even to list wallets", async () => {
    mocks.admin.mockResolvedValue({ session: null, response: Response.json({ error: "No admin session" }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect((await POST(request("POST", { walletAddress: address, label: "Owner", confirmed: true }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation, valid viem address, and same-origin writes", async () => {
    expect((await POST(request("POST", { walletAddress: address, label: "Owner" }))).status).toBe(400);
    expect((await POST(request("POST", { walletAddress: "not-a-wallet", label: "Owner", confirmed: true }))).status).toBe(400);
    expect((await DELETE(request("DELETE", { walletAddress: address, confirmed: true }, "https://evil.example"))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.disable).not.toHaveBeenCalled();
  });

  it("persists explicit additions/removals and audits both with the normalized address", async () => {
    expect((await POST(request("POST", { walletAddress: address, label: "Mark Owner Wallet", confirmed: true }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(address, "Mark Owner Wallet");
    expect(mocks.audit).toHaveBeenCalledWith(expect.any(Request), "owner@example.test", "owner_wallet.add", "admin_wallets", address.toLowerCase(), "success", { label: "Mark Owner Wallet" });

    expect((await DELETE(request("DELETE", { walletAddress: address, confirmed: true }))).status).toBe(200);
    expect(mocks.disable).toHaveBeenCalledWith(address);
    expect(mocks.audit).toHaveBeenCalledWith(expect.any(Request), "owner@example.test", "owner_wallet.remove", "admin_wallets", address.toLowerCase(), "success");
  });
});
