import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { normalizeWalletAddress } from "@/lib/wallet/address";
import {
  authenticateWalletCookie,
  issueWalletChallenge,
  revokeWalletCookie,
  verifyWalletChallenge,
  WalletAuthError,
  type WalletAuthRuntime,
} from "@/lib/wallet/auth";
import type {
  WalletAccountRecord,
  WalletAuthStore,
  WalletNonceRecord,
  WalletSessionRecord,
} from "@/lib/wallet/store";
import { clearWalletSessionCookie, serializeWalletSessionCookie } from "@/lib/wallet/session";

class MemoryWalletAuthStore implements WalletAuthStore {
  readonly nonces = new Map<string, WalletNonceRecord>();
  readonly accounts = new Map<string, WalletAccountRecord>();
  readonly profiles = new Map<string, string>();
  readonly sessions = new Map<string, WalletSessionRecord & { sessionTokenHash: string }>();

  async createNonce(input: {
    walletAddress: Address;
    walletAddressUniqueKey: string;
    nonceHash: string;
    expiresAt: string;
  }) {
    this.nonces.set(input.nonceHash, {
      id: crypto.randomUUID(),
      ...input,
      usedAt: null,
    });
  }

  async findNonce(nonceHash: string) {
    return this.nonces.get(nonceHash) ?? null;
  }

  async consumeNonce(input: { id: string; walletAddressUniqueKey: string; consumedAt: string }) {
    const nonce = [...this.nonces.values()].find((candidate) => candidate.id === input.id);
    if (
      !nonce || nonce.usedAt || nonce.walletAddressUniqueKey !== input.walletAddressUniqueKey ||
      new Date(nonce.expiresAt).getTime() <= new Date(input.consumedAt).getTime()
    ) return false;
    nonce.usedAt = input.consumedAt;
    return true;
  }

  async upsertWalletAccount(input: {
    walletAddress: Address;
    walletAddressUniqueKey: string;
  }) {
    const existing = this.accounts.get(input.walletAddressUniqueKey);
    if (existing) return existing;
    const created = { id: crypto.randomUUID(), ...input };
    this.accounts.set(input.walletAddressUniqueKey, created);
    return created;
  }

  async ensureProfile(walletAccountId: string) {
    const existing = this.profiles.get(walletAccountId);
    if (existing) return existing;
    const profileId = crypto.randomUUID();
    this.profiles.set(walletAccountId, profileId);
    return profileId;
  }

  async createSession(input: {
    id: string;
    walletAccountId: string;
    sessionTokenHash: string;
    expiresAt: string;
  }) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === input.walletAccountId);
    const profileId = this.profiles.get(input.walletAccountId);
    if (!account || !profileId) throw new Error("missing test account");
    this.sessions.set(input.id, {
      ...input,
      profileId,
      walletAddress: account.walletAddress,
      walletAddressUniqueKey: account.walletAddressUniqueKey,
      revokedAt: null,
    });
  }

  async findSession(sessionTokenHash: string) {
    return [...this.sessions.values()].find((session) => session.sessionTokenHash === sessionTokenHash) ?? null;
  }

  async revokeSession(input: { sessionTokenHash: string; revokedAt: string }) {
    const session = [...this.sessions.values()].find((candidate) => candidate.sessionTokenHash === input.sessionTokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = input.revokedAt;
    return true;
  }
}

function setup() {
  const store = new MemoryWalletAuthStore();
  let now = new Date("2026-09-23T04:00:00.000Z");
  const runtime: WalletAuthRuntime = {
    store,
    appUrl: "https://cabi.example",
    sessionSecret: "test-session-secret-that-is-long-and-random",
    now: () => now,
    randomNonce: () => "ABCDEF1234567890",
    randomSessionToken: () => "test-session-token-that-is-long-enough-1234567890",
  };
  return { store, runtime, setNow(value: string) { now = new Date(value); } };
}

async function expectAuthCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("Expected wallet authentication to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(WalletAuthError);
    expect((error as WalletAuthError).code).toBe(code);
  }
}

describe("EVM address normalization", () => {
  it("rejects invalid and bad-checksum EVM addresses", () => {
    expect(() => normalizeWalletAddress("not-an-address")).toThrow("INVALID_WALLET_ADDRESS");
    expect(() => normalizeWalletAddress("0x52908400098527886e0f7030069857D2e4169ee7")).toThrow("INVALID_WALLET_ADDRESS");
  });

  it("maps case variants to one unique lookup key", () => {
    const lower = normalizeWalletAddress("0xde709f2102306220921060314715629080e2fb77");
    const checksum = normalizeWalletAddress(lower.address);
    expect(checksum.uniqueKey).toBe(lower.uniqueKey);
    expect(checksum.address).toBe(lower.address);
  });
});

describe("SIWE authentication", () => {
  it("rejects malformed signatures", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    await expectAuthCode(verifyWalletChallenge({ message: challenge.message, signature: "0x1234" }, runtime), "INVALID_SIGNATURE");
  });

  it("allows bounded variable-length smart-account signatures", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const signature = `0x${"11".repeat(96)}` as `0x${string}`;
    runtime.verifySignature = async (input) => input.chainId === 8453 && input.signature === signature;
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 8453 }, runtime);
    await expect(verifyWalletChallenge({ message: challenge.message, signature }, runtime)).resolves.toMatchObject({
      identity: { walletAddress: account.address },
    });
  });

  it("rejects a signature made by a different wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 8453 }, runtime);
    const signature = await other.signMessage({ message: challenge.message });
    await expectAuthCode(verifyWalletChallenge({ message: challenge.message, signature }, runtime), "INVALID_SIGNATURE");
  });

  it("rejects an expired nonce even while the signed message expiration is still in the future", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime, store, setNow } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    const record = [...store.nonces.values()][0];
    record.expiresAt = "2026-09-23T04:00:01.000Z";
    const signature = await account.signMessage({ message: challenge.message });
    setNow("2026-09-23T04:00:02.000Z");
    await expectAuthCode(verifyWalletChallenge({ message: challenge.message, signature }, runtime), "NONCE_EXPIRED");
  });

  it("consumes a nonce exactly once", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    const signature = await account.signMessage({ message: challenge.message });
    await expect(verifyWalletChallenge({ message: challenge.message, signature }, runtime)).resolves.toBeDefined();
    await expectAuthCode(verifyWalletChallenge({ message: challenge.message, signature }, runtime), "NONCE_ALREADY_USED");
  });

  it("authenticates on an unconfigured EVM chain without requiring a chain-config row", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 987_654_321 }, runtime);
    expect(challenge.message).toContain("Chain ID: 987654321");
    const signature = await account.signMessage({ message: challenge.message });
    await expect(verifyWalletChallenge({ message: challenge.message, signature }, runtime)).resolves.toMatchObject({
      identity: { walletAddress: account.address },
    });
  });

  it("rejects a message altered after signing", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    const signature = await account.signMessage({ message: challenge.message });
    const altered = challenge.message.replace("Sign in to Cabi", "Log in to Cabi");
    await expectAuthCode(verifyWalletChallenge({ message: altered, signature }, runtime), "SIWE_STATEMENT_MISMATCH");
  });

  it("rejects a different signed SIWE statement even when the nonce and wallet are valid", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    const altered = challenge.message.replace(
      "Sign in to Cabi to save your chats. This is free, costs no gas, and does not send a transaction.",
      "Sign in to an unrelated service.",
    );
    const signature = await account.signMessage({ message: altered });
    await expectAuthCode(verifyWalletChallenge({ message: altered, signature }, runtime), "SIWE_STATEMENT_MISMATCH");
  });

  it("rejects authentication domain and URI mismatches before creating a session", async () => {
    const account = privateKeyToAccount(generatePrivateKey());

    const first = setup();
    const domainChallenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, first.runtime);
    const domainSignature = await account.signMessage({ message: domainChallenge.message });
    first.runtime.appUrl = "https://other.example";
    await expectAuthCode(
      verifyWalletChallenge({ message: domainChallenge.message, signature: domainSignature }, first.runtime),
      "SIWE_DOMAIN_MISMATCH",
    );

    const second = setup();
    const uriChallenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, second.runtime);
    const alteredUri = uriChallenge.message.replace("URI: https://cabi.example", "URI: https://cabi.example/wrong");
    const uriSignature = await account.signMessage({ message: alteredUri });
    await expectAuthCode(verifyWalletChallenge({ message: alteredUri, signature: uriSignature }, second.runtime), "SIWE_URI_MISMATCH");
  });
});

describe("wallet session revocation", () => {
  it("serializes an HttpOnly same-site credential and an explicit clearing cookie", () => {
    const cookie = serializeWalletSessionCookie("opaque-signed-token");
    expect(cookie).toContain("cabi_wallet_session=opaque-signed-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(clearWalletSessionCookie()).toContain("Max-Age=0");
  });

  it("authenticates only the signed, unrevoked database-backed session and invalidates it on logout", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { runtime } = setup();
    const challenge = await issueWalletChallenge({ address: account.address, chainId: 1 }, runtime);
    const signature = await account.signMessage({ message: challenge.message });
    const { cookieValue, identity } = await verifyWalletChallenge({ message: challenge.message, signature }, runtime);

    await expect(authenticateWalletCookie(cookieValue, runtime)).resolves.toMatchObject({
      sessionId: identity.sessionId,
      walletAccountId: identity.walletAccountId,
      walletAddress: account.address,
    });
    await expect(authenticateWalletCookie(`${cookieValue}tampered`, runtime)).resolves.toBeNull();
    await expect(revokeWalletCookie(cookieValue, runtime)).resolves.toBe(true);
    await expect(authenticateWalletCookie(cookieValue, runtime)).resolves.toBeNull();
    await expect(revokeWalletCookie(cookieValue, runtime)).resolves.toBe(false);
  });
});
