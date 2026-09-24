import "server-only";

import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";

import { createTtlCache } from "@/lib/wallet-data/cache";

/**
 * The trusted $CPU balance read.
 *
 * This is the only place the holder gate learns what a wallet holds. Three rules
 * hold here and nowhere else needs to repeat them:
 *
 * 1. The contract, the chain, and the RPC all come from server configuration. A
 *    request can never supply any of them, so a caller cannot point the read at
 *    a token they control.
 * 2. `decimals()` is READ FROM THE CONTRACT on every check. It is never assumed,
 *    and a malformed answer fails the check closed instead of defaulting to 18.
 * 3. Comparison is `bigint` against `bigint`. No value that decides access
 *    passes through a JavaScript `number`.
 *
 * Every failure mode - no chain configured, RPC unreachable, a contract that
 * does not answer as an ERC-20 - returns `ok: false`. The caller fails closed.
 */

const ERC20_ACCESS_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const RPC_TIMEOUT_MS = 8_000;

/** Short-lived on purpose: eligibility is re-read within this window on every protected request. */
export const cpuBalanceTtlMs = 30_000;

export type CpuBalanceCheck = {
  /** Raw base-unit balance, the only value an authorization decision may use. */
  raw: bigint;
  /** Decimals reported by the contract. */
  decimals: number;
  /** Display ticker, sanitised; falls back to the configured ticker. */
  symbol: string;
  contract: string;
  chainId: number;
  /** Whole $CPU required, from server configuration. */
  minimum: number;
  /** `minimum * 10n ** BigInt(decimals)`, computed with bigint. */
  requiredRaw: bigint;
  /** `requiredRaw - raw` when the wallet is short, otherwise `0n`. */
  deficitRaw: bigint;
  /** Raw bigint comparison - the single authorization predicate. */
  meetsMinimum: boolean;
  /** True when this result came from the short-lived cache. */
  cached: boolean;
};

export type CpuBalanceResult =
  | { ok: true; data: CpuBalanceCheck }
  | { ok: false; error: "CPU_CHECK_FAILED"; message: string };

export type CpuBalanceConfig = {
  contract: string;
  chainId: number;
  rpcUrl: string;
  minimum: number;
  /** Exact ticker to show when the contract does not answer `symbol()`. */
  fallbackSymbol?: string;
};

const balanceCache = createTtlCache<Omit<CpuBalanceCheck, "minimum" | "requiredRaw" | "deficitRaw" | "meetsMinimum" | "cached">>(cpuBalanceTtlMs, 5_000);

/** Clears the cache for one wallet, or all of them. */
export function invalidateCpuBalance(walletAddress?: string) {
  if (!walletAddress) {
    balanceCache.clear();
    return;
  }
  const lowered = walletAddress.toLowerCase();
  balanceCache.deleteWhere((key) => key.endsWith(`:${lowered}`));
}

function unusableChainMessage(chainId: number): string {
  return `Cabi has no verified RPC for the $CPU network (chain ${chainId}).`;
}

/**
 * `minimum x 10^decimals`, as a raw base-unit bigint.
 *
 * This is the entire authorization arithmetic. It is integer-only: a whole-token
 * minimum scaled by the contract's own decimals, compared against `balanceOf`.
 * No JavaScript `number` is ever used to represent a token amount that decides
 * access.
 */
export function requiredFor(minimum: number, decimals: number): bigint {
  return BigInt(minimum) * 10n ** BigInt(decimals);
}

/** Raw bigint comparison - the single authorization predicate. */
export function meetsCpuMinimum(raw: bigint, minimum: number, decimals: number): boolean {
  return raw >= requiredFor(minimum, decimals);
}

export async function readCpuAccessBalance(input: {
  address: unknown;
  config: CpuBalanceConfig;
  /** Bypass the cache - used by "Check Again" and by wallet/account switches. */
  fresh?: boolean;
}): Promise<CpuBalanceResult> {
  const { config } = input;
  if (typeof input.address !== "string" || !isAddress(input.address, { strict: false })) {
    return { ok: false, error: "CPU_CHECK_FAILED", message: "Cabi couldn't read a valid wallet address." };
  }
  if (typeof config.contract !== "string" || !isAddress(config.contract, { strict: false })) {
    return { ok: false, error: "CPU_CHECK_FAILED", message: "The official $CPU contract is not configured." };
  }
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    return { ok: false, error: "CPU_CHECK_FAILED", message: unusableChainMessage(config.chainId) };
  }
  if (!Number.isSafeInteger(config.minimum) || config.minimum < 1) {
    return { ok: false, error: "CPU_CHECK_FAILED", message: "The $CPU access requirement is not configured." };
  }

  let rpc: URL;
  try {
    rpc = new URL(config.rpcUrl);
  } catch {
    return { ok: false, error: "CPU_CHECK_FAILED", message: unusableChainMessage(config.chainId) };
  }
  if (rpc.protocol !== "https:" || rpc.username || rpc.password) {
    return { ok: false, error: "CPU_CHECK_FAILED", message: unusableChainMessage(config.chainId) };
  }

  const owner = getAddress(input.address.toLowerCase()) as Address;
  const contract = getAddress(config.contract.toLowerCase()) as Address;
  const cacheKey = `${config.chainId}:${contract}:${owner.toLowerCase()}`;

  let read: { raw: bigint; decimals: number; symbol: string } | null = null;
  if (!input.fresh) {
    const hit = balanceCache.get(cacheKey);
    if (hit) read = { raw: hit.value.raw, decimals: hit.value.decimals, symbol: hit.value.symbol };
  }

  const cached = read !== null;
  if (!read) {
    try {
      const client = createPublicClient({
        transport: http(config.rpcUrl, { retryCount: 1, timeout: RPC_TIMEOUT_MS }),
      });
      const [rawBalance, rawDecimals, rawSymbol] = await Promise.all([
        client.readContract({ address: contract, abi: ERC20_ACCESS_ABI, functionName: "balanceOf", args: [owner] }) as Promise<bigint>,
        client.readContract({ address: contract, abi: ERC20_ACCESS_ABI, functionName: "decimals" }) as Promise<number>,
        client.readContract({ address: contract, abi: ERC20_ACCESS_ABI, functionName: "symbol" }).catch(() => null) as Promise<string | null>,
      ]);

      if (typeof rawBalance !== "bigint" || rawBalance < 0n) {
        return { ok: false, error: "CPU_CHECK_FAILED", message: "That contract didn't answer as an ERC-20 balance." };
      }
      // `decimals()` must answer with a real number. A missing, malformed, or
      // absurd value is a fail-closed condition: guessing 18 (or treating a
      // missing answer as 0) is exactly the mistake the requirement forbids.
      const decimals = rawDecimals;
      if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        return { ok: false, error: "CPU_CHECK_FAILED", message: "That contract reported an unusable decimals value." };
      }
      const symbol = typeof rawSymbol === "string" && rawSymbol.trim()
        ? rawSymbol.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim().slice(0, 16)
        : (config.fallbackSymbol?.slice(0, 16) || "CPU");

      read = { raw: rawBalance, decimals, symbol };
      balanceCache.set(cacheKey, { raw: rawBalance, decimals, symbol, contract, chainId: config.chainId });
    } catch {
      return { ok: false, error: "CPU_CHECK_FAILED", message: "Cabi couldn't reach the $CPU network." };
    }
  }

  const requiredRaw = requiredFor(config.minimum, read.decimals);
  const meetsMinimum = read.raw >= requiredRaw;
  return {
    ok: true,
    data: {
      raw: read.raw,
      decimals: read.decimals,
      symbol: read.symbol,
      contract,
      chainId: config.chainId,
      minimum: config.minimum,
      requiredRaw,
      deficitRaw: meetsMinimum ? 0n : requiredRaw - read.raw,
      meetsMinimum,
      cached,
    },
  };
}
