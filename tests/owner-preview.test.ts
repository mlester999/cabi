import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: null as string | null,
  wallet: vi.fn(),
  authorized: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined }) }));
vi.mock("@/lib/wallet/session", () => ({ readWalletAuth: mocks.wallet }));
vi.mock("@/lib/site/owner-wallets", () => ({ isAuthorizedOwnerWallet: mocks.authorized }));

import {
  clearOwnerPreviewCookie,
  createOwnerPreviewToken,
  readOwnerPreviewAuth,
  serializeOwnerPreviewCookie,
} from "@/lib/site/owner-preview";

const owner = {
  sessionId: "e98e1913-07a0-4a79-bad0-7d0cb355356a",
  walletAccountId: "wallet-owner",
  profileId: "profile-owner",
  walletAddress: "0x00000000000000000000000000000000000000A1" as const,
  walletAddressUniqueKey: "0x00000000000000000000000000000000000000a1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("owner preview credential", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.cookie = null;
    mocks.wallet.mockReset();
    mocks.authorized.mockReset();
    mocks.wallet.mockResolvedValue(owner);
    mocks.authorized.mockResolvedValue(true);
  });

  it("requires a signed preview credential even for an approved signed-in wallet", async () => {
    expect(await readOwnerPreviewAuth()).toBeNull();
    expect(mocks.wallet).not.toHaveBeenCalled();
  });

  it("admits a matching wallet session only while the allowlist still approves it", async () => {
    mocks.cookie = await createOwnerPreviewToken(owner);
    expect(await readOwnerPreviewAuth()).toMatchObject({ walletAccountId: owner.walletAccountId });
    mocks.authorized.mockResolvedValue(false);
    expect(await readOwnerPreviewAuth()).toBeNull();
  });

  it("rejects a copied credential with a different or revoked wallet session", async () => {
    mocks.cookie = await createOwnerPreviewToken(owner);
    mocks.wallet.mockResolvedValue({ ...owner, sessionId: crypto.randomUUID() });
    expect(await readOwnerPreviewAuth()).toBeNull();
    mocks.wallet.mockResolvedValue(null);
    expect(await readOwnerPreviewAuth()).toBeNull();
  });

  it("rejects tampering and expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
    mocks.cookie = await createOwnerPreviewToken(owner);
    expect(await readOwnerPreviewAuth()).not.toBeNull();
    const valid = mocks.cookie;
    mocks.cookie = `${valid}tampered`;
    expect(await readOwnerPreviewAuth()).toBeNull();
    mocks.cookie = valid;
    vi.setSystemTime(new Date("2026-09-24T04:00:01.000Z"));
    expect(await readOwnerPreviewAuth()).toBeNull();
    vi.useRealTimers();
  });

  it("uses an HttpOnly short-lived cookie and clears it on exit", () => {
    expect(serializeOwnerPreviewCookie("signed")).toContain("HttpOnly; SameSite=Lax");
    expect(serializeOwnerPreviewCookie("signed")).toContain("Max-Age=14400");
    expect(clearOwnerPreviewCookie()).toContain("Max-Age=0");
  });
});
