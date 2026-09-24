import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  verify: vi.fn(),
  authorized: vi.fn(),
  markUsed: vi.fn(),
  token: vi.fn(),
  siteMode: vi.fn(async () => ({ mode: "PRELAUNCH", source: "database" as const, override: false })),
}));

vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/wallet/auth", () => ({
  createWalletAuthRuntime: () => ({}),
  verifyWalletChallenge: mocks.verify,
  WalletAuthError: class WalletAuthError extends Error {
    constructor(readonly code: string, message: string, readonly status = 401) { super(message); }
  },
}));
vi.mock("@/lib/wallet/session", () => ({ serializeWalletSessionCookie: (value: string) => `wallet=${value}; HttpOnly` }));
vi.mock("@/lib/site/owner-wallets", () => ({ isAuthorizedOwnerWallet: mocks.authorized, markOwnerWalletUsed: mocks.markUsed }));
vi.mock("@/lib/site/owner-preview", () => ({
  createOwnerPreviewToken: mocks.token,
  serializeOwnerPreviewCookie: (value: string) => `preview=${value}; HttpOnly`,
  clearOwnerPreviewCookie: () => "preview=; Max-Age=0",
}));
// The site mode decides whether the holder gate is even asked. It stays
// PRELAUNCH here, so the response must say so and touch no chain.
vi.mock("@/lib/site/mode", () => ({
  getSiteMode: mocks.siteMode,
  siteModeAllowsApp: (mode: string) => mode === "LIVE",
}));

import { POST } from "@/app/api/wallet/verify/route";

const identity = {
  sessionId: "e98e1913-07a0-4a79-bad0-7d0cb355356a",
  walletAccountId: "wallet-owner",
  profileId: "profile-owner",
  walletAddress: "0x00000000000000000000000000000000000000A1",
  walletAddressUniqueKey: "0x00000000000000000000000000000000000000a1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function request() {
  return new Request("http://localhost:5173/api/wallet/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "signed SIWE message", signature: "0xsigned" }),
  });
}

describe("wallet verification preview authorization", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.verify.mockResolvedValue({ identity, cookieValue: "wallet-session" });
    mocks.authorized.mockResolvedValue(false);
    mocks.markUsed.mockResolvedValue(undefined);
    mocks.token.mockResolvedValue("owner-preview-token");
  });

  it("keeps an authenticated but unapproved wallet on prelaunch", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, previewAuthorized: false });
    expect(response.headers.get("set-cookie")).toContain("preview=; Max-Age=0");
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("reports the holder-gate answer from the server, not from the request", async () => {
    const body = await (await POST(request())).json() as { cpuHolder?: { allowed?: boolean; reason?: string } };
    // PRELAUNCH: the sign-in succeeds, but a $CPU balance never unlocks it.
    expect(body.cpuHolder).toMatchObject({ allowed: false, reason: "PRELAUNCH" });
  });

  it("mints preview only after signature verification and allowlist approval", async () => {
    mocks.authorized.mockResolvedValue(true);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ authenticated: true, previewAuthorized: true });
    expect(response.headers.get("set-cookie")).toContain("preview=owner-preview-token");
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.authorized.mock.invocationCallOrder[0]);
    expect(mocks.authorized).toHaveBeenCalledWith(identity.walletAddress);
    expect(mocks.token).toHaveBeenCalledWith(identity);
    expect(mocks.markUsed).toHaveBeenCalledWith(identity.walletAddress);
  });

  it("never checks the allowlist or grants preview when signature/nonce verification fails", async () => {
    mocks.verify.mockRejectedValue(new Error("invalid signature or expired nonce"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.authorized).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails preview closed while allowing ordinary wallet sign-in if the allowlist is unavailable", async () => {
    mocks.authorized.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, previewAuthorized: false });
    expect(response.headers.get("set-cookie")).toContain("preview=; Max-Age=0");
  });
});
