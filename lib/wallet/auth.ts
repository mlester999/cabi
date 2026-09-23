import "server-only";

import { createPublicClient, defineChain, http, isHex, size, verifyMessage, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

import { env, isProduction, publicAppUrl } from "@/lib/config/env";
import { base64, hashValue, signValue, verifySignedValue } from "@/lib/security/crypto";
import { normalizeWalletAddress } from "@/lib/wallet/address";
import { getWalletProductConfig } from "@/lib/wallet/config";
import { createSupabaseWalletAuthStore, type WalletAuthStore } from "@/lib/wallet/store";

export const walletSessionCookieName = "cabi_wallet_session";
export const walletNonceTtlMs = 5 * 60 * 1_000;
export const walletSessionTtlMs = 7 * 24 * 60 * 60 * 1_000;

const maxMessageLength = 4_096;
const maxFutureIssuedAtSkewMs = 60_000;
const signInStatement = "Sign in to Cabi to save your chats. This is free, costs no gas, and does not send a transaction.";

export class WalletAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
    this.status = status;
  }
}

export type WalletAuthIdentity = {
  sessionId: string;
  walletAccountId: string;
  profileId: string;
  walletAddress: Address;
  walletAddressUniqueKey: string;
  expiresAt: string;
};

export type WalletAuthRuntime = {
  store: WalletAuthStore;
  appUrl: string;
  sessionSecret: string;
  now?: () => Date;
  randomNonce?: () => string;
  randomSessionToken?: () => string;
  verifySignature?: (input: { address: Address; message: string; signature: Hex; chainId: number }) => Promise<boolean>;
};

async function verifyEvmWalletSignature(input: { address: Address; message: string; signature: Hex; chainId: number }) {
  // EOAs can be verified locally and do not depend on an RPC being healthy.
  try {
    if (await verifyMessage(input)) return true;
  } catch { /* Contract signatures are handled on the configured chain below. */ }

  // viem's public-client action supports ERC-1271 and ERC-6492 smart-account
  // signatures. Only an owner-configured HTTPS RPC is ever contacted.
  const config = await getWalletProductConfig();
  const configured = config.chains.find((chain) => chain.enabled && chain.id === input.chainId);
  if (!configured) return false;
  const chain = defineChain({
    id: configured.id,
    name: configured.name,
    nativeCurrency: configured.nativeCurrency,
    rpcUrls: { default: { http: [configured.rpcUrl] } },
    blockExplorers: configured.blockExplorerUrl ? { default: { name: `${configured.name} explorer`, url: configured.blockExplorerUrl } } : undefined,
  });
  const client = createPublicClient({
    chain,
    transport: http(configured.rpcUrl, { retryCount: 0, timeout: 10_000 }),
  });
  return client.verifyMessage(input);
}

function walletSessionSecret() {
  const secret = env("SESSION_SECRET") ?? env("APP_ENCRYPTION_KEY");
  if (!secret) {
    if (isProduction()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
    return "cabi-development-session-secret-change-me";
  }
  return secret;
}

export function createWalletAuthRuntime(): WalletAuthRuntime {
  return {
    store: createSupabaseWalletAuthStore(),
    appUrl: publicAppUrl(),
    sessionSecret: walletSessionSecret(),
    verifySignature: verifyEvmWalletSignature,
  };
}

function canonicalOrigin(appUrl: string) {
  try {
    const url = new URL(appUrl);
    return { domain: url.host, uri: url.origin };
  } catch {
    throw new Error("APP_URL_INVALID");
  }
}

function currentTime(runtime: WalletAuthRuntime) {
  const now = runtime.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_AUTH_CLOCK");
  return now;
}

function randomHex(bytes: number) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return base64.encode(crypto.getRandomValues(new Uint8Array(32)));
}

function authError(code: string, message: string, status = 401): never {
  throw new WalletAuthError(code, message, status);
}

export async function issueWalletChallenge(
  input: { address: unknown; chainId: unknown },
  runtime: WalletAuthRuntime,
) {
  let normalized;
  try {
    normalized = normalizeWalletAddress(input.address);
  } catch {
    authError("INVALID_WALLET_ADDRESS", "Enter a valid EVM wallet address.", 400);
  }
  if (!Number.isSafeInteger(input.chainId) || (input.chainId as number) <= 0) {
    authError("INVALID_CHAIN_ID", "A valid EVM chain ID is required.", 400);
  }

  const now = currentTime(runtime);
  const expiresAt = new Date(now.getTime() + walletNonceTtlMs);
  const nonce = runtime.randomNonce?.() ?? randomHex(16);
  if (!/^[A-Za-z0-9]{8,96}$/u.test(nonce)) throw new Error("INVALID_GENERATED_NONCE");
  const { domain, uri } = canonicalOrigin(runtime.appUrl);
  const message = createSiweMessage({
    address: normalized.address,
    chainId: input.chainId as number,
    domain,
    uri,
    version: "1",
    nonce,
    issuedAt: now,
    expirationTime: expiresAt,
    statement: signInStatement,
  });

  await runtime.store.createNonce({
    walletAddress: normalized.address,
    walletAddressUniqueKey: normalized.uniqueKey,
    nonceHash: await hashValue(nonce),
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return { message, expiresAt: expiresAt.toISOString() };
}

function requireParsedMessage(message: string) {
  if (!message || message.length > maxMessageLength) {
    authError("INVALID_SIWE_MESSAGE", "The sign-in message is malformed.", 400);
  }
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    authError("INVALID_SIWE_MESSAGE", "The sign-in message is malformed.", 400);
  }
  if (
    !parsed.address || !parsed.domain || !parsed.uri || !parsed.nonce ||
    parsed.version !== "1" || !Number.isSafeInteger(parsed.chainId) || (parsed.chainId ?? 0) <= 0 ||
    !(parsed.issuedAt instanceof Date) || !Number.isFinite(parsed.issuedAt.getTime()) ||
    !(parsed.expirationTime instanceof Date) || !Number.isFinite(parsed.expirationTime.getTime())
  ) {
    authError("INVALID_SIWE_MESSAGE", "The sign-in message is malformed.", 400);
  }
  return parsed as ReturnType<typeof parseSiweMessage> & {
    address: Address;
    domain: string;
    uri: string;
    nonce: string;
    chainId: number;
    issuedAt: Date;
    expirationTime: Date;
    version: "1";
  };
}

function requireSignature(signature: unknown): Hex {
  if (typeof signature !== "string" || !isHex(signature, { strict: true })) {
    authError("INVALID_SIGNATURE", "The wallet signature is invalid.");
  }
  const byteLength = size(signature);
  if (byteLength < 1 || byteLength > 32_768) authError("INVALID_SIGNATURE", "The wallet signature is invalid.");
  return signature;
}

export async function verifyWalletChallenge(
  input: { message: unknown; signature: unknown },
  runtime: WalletAuthRuntime,
): Promise<{ identity: WalletAuthIdentity; cookieValue: string }> {
  if (typeof input.message !== "string") {
    authError("INVALID_SIWE_MESSAGE", "The sign-in message is malformed.", 400);
  }
  const message = input.message;
  const parsed = requireParsedMessage(message);
  const signature = requireSignature(input.signature);
  const now = currentTime(runtime);
  const expected = canonicalOrigin(runtime.appUrl);

  if (parsed.domain !== expected.domain) authError("SIWE_DOMAIN_MISMATCH", "The sign-in domain does not match this site.");
  if (parsed.uri !== expected.uri) authError("SIWE_URI_MISMATCH", "The sign-in URI does not match this site.");
  if (parsed.statement !== signInStatement) authError("SIWE_STATEMENT_MISMATCH", "The sign-in statement does not match this site.");
  if (parsed.issuedAt.getTime() > now.getTime() + maxFutureIssuedAtSkewMs) {
    authError("SIWE_NOT_YET_VALID", "The sign-in message is not valid yet.");
  }
  if (parsed.expirationTime.getTime() <= now.getTime()) {
    authError("SIWE_MESSAGE_EXPIRED", "The sign-in request has expired.");
  }

  let normalized;
  try {
    normalized = normalizeWalletAddress(parsed.address);
  } catch {
    authError("INVALID_WALLET_ADDRESS", "The sign-in message contains an invalid wallet address.", 400);
  }

  const nonceHash = await hashValue(parsed.nonce);
  const nonce = await runtime.store.findNonce(nonceHash);
  if (!nonce) authError("INVALID_NONCE", "The sign-in request is invalid or has expired.");
  if (nonce.usedAt) authError("NONCE_ALREADY_USED", "This sign-in request has already been used.");
  if (new Date(nonce.expiresAt).getTime() <= now.getTime()) authError("NONCE_EXPIRED", "The sign-in request has expired.");
  if (nonce.walletAddressUniqueKey !== normalized.uniqueKey) {
    authError("NONCE_ADDRESS_MISMATCH", "The sign-in request belongs to a different wallet.");
  }

  let signatureValid = false;
  try {
    signatureValid = await (runtime.verifySignature ?? verifyMessage)({
      address: normalized.address,
      message,
      signature,
      chainId: parsed.chainId,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) authError("INVALID_SIGNATURE", "The wallet signature could not be verified.");

  const consumed = await runtime.store.consumeNonce({
    id: nonce.id,
    walletAddressUniqueKey: normalized.uniqueKey,
    consumedAt: now.toISOString(),
  });
  if (!consumed) authError("NONCE_ALREADY_USED", "This sign-in request has already been used.");

  const account = await runtime.store.upsertWalletAccount({
    walletAddress: normalized.address,
    walletAddressUniqueKey: normalized.uniqueKey,
    lastLoginAt: now.toISOString(),
  });
  const profileId = await runtime.store.ensureProfile(account.id);
  const sessionId = crypto.randomUUID();
  const sessionToken = runtime.randomSessionToken?.() ?? randomToken();
  const sessionTokenHash = await hashValue(sessionToken);
  const expiresAt = new Date(now.getTime() + walletSessionTtlMs);
  await runtime.store.createSession({
    id: sessionId,
    walletAccountId: account.id,
    sessionTokenHash,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  const identity: WalletAuthIdentity = {
    sessionId,
    walletAccountId: account.id,
    profileId,
    walletAddress: account.walletAddress,
    walletAddressUniqueKey: account.walletAddressUniqueKey,
    expiresAt: expiresAt.toISOString(),
  };
  // The cookie carries only a signed, random bearer secret. All identity and
  // expiry claims remain authoritative in the revocable database row.
  const cookieValue = await signValue(sessionToken, runtime.sessionSecret);
  return { identity, cookieValue };
}

async function decodeWalletCookie(cookieValue: string | null | undefined, secret: string): Promise<string | null> {
  if (!cookieValue || cookieValue.length > 2_048) return null;
  const sessionToken = await verifySignedValue(cookieValue, secret);
  if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(sessionToken)) return null;
  return sessionToken;
}

export async function authenticateWalletCookie(
  cookieValue: string | null | undefined,
  runtime: WalletAuthRuntime,
): Promise<WalletAuthIdentity | null> {
  const sessionToken = await decodeWalletCookie(cookieValue, runtime.sessionSecret);
  if (!sessionToken) return null;
  const now = currentTime(runtime);
  const session = await runtime.store.findSession(await hashValue(sessionToken));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= now.getTime()) return null;
  return {
    sessionId: session.id,
    walletAccountId: session.walletAccountId,
    profileId: session.profileId,
    walletAddress: session.walletAddress,
    walletAddressUniqueKey: session.walletAddressUniqueKey,
    expiresAt: session.expiresAt,
  };
}

export async function revokeWalletCookie(
  cookieValue: string | null | undefined,
  runtime: WalletAuthRuntime,
): Promise<boolean> {
  const sessionToken = await decodeWalletCookie(cookieValue, runtime.sessionSecret);
  if (!sessionToken) return false;
  return runtime.store.revokeSession({
    sessionTokenHash: await hashValue(sessionToken),
    revokedAt: currentTime(runtime).toISOString(),
  });
}
