import "server-only";

import { createPublicClient, formatUnits, getAddress, http, isAddress, type Address } from "viem";

import { assertUsableChain } from "@/lib/wallet-data/chain";
import { tidyAmount } from "@/lib/wallet-data/balance";
import type { TokenHolding, WalletDataResult } from "@/lib/wallet-data/types";
import type { CpuTokenConfig, SupportedChainConfig } from "@/lib/wallet/config";

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const RPC_TIMEOUT_MS = 8_000;

/**
 * Token holdings.
 *
 * IMPORTANT SCOPE DECISION: this reads balances for tokens the OWNER has
 * configured ? today that means `$CPU` ? rather than enumerating every ERC-20 an
 * address has ever touched. Enumerating arbitrary holdings needs either an
 * indexer or a `Transfer`-log scan, and neither is available from a plain RPC
 * without a large, slow, and unreliable query. Returning a short honest list is
 * better than presenting a partial scan as "your portfolio".
 *
 * Metadata (decimals/name/symbol) is read from the contract itself and sanitised
 * before display, so token metadata can never inject markup.
 */

/** Strips control characters and length-caps an onchain string before display. */
export function sanitizeTokenText(value: unknown, fallback: string, maxLength = 48) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLength);
}

export type ConfiguredToken = { address: string; label?: string; verifiedUrl?: string; configured?: boolean };

/** Builds the list of tokens worth checking, from owner configuration only. */
export function configuredTokens(cpu: CpuTokenConfig): ConfiguredToken[] {
  const tokens: ConfiguredToken[] = [];
  if (cpu.contractAddress && isAddress(cpu.contractAddress, { strict: false })) {
    tokens.push({
      address: getAddress(cpu.contractAddress.toLowerCase()),
      label: cpu.ticker || "CPU",
      verifiedUrl: cpu.clankTradeUrl || undefined,
      configured: true,
    });
  }
  return tokens;
}

export async function readTokenHoldings(
  chain: SupportedChainConfig | undefined,
  address: string,
  tokens: ConfiguredToken[],
): Promise<WalletDataResult<TokenHolding[]>> {
  const usable = assertUsableChain(chain);
  if (!usable.ok) return { ok: false, error: "UNSUPPORTED_CHAIN", message: usable.reason };
  if (!isAddress(address, { strict: false })) return { ok: false, error: "INVALID_ADDRESS", message: "That wallet address isn't valid." };
  if (tokens.length === 0) return { ok: true, data: [], updatedAt: Date.now(), stale: false };

  const client = createPublicClient({ transport: http(usable.chain.rpcUrl, { retryCount: 1, timeout: RPC_TIMEOUT_MS }) });
  const owner = getAddress(address.toLowerCase()) as Address;

  const results = await Promise.all(tokens.map(async (token): Promise<TokenHolding | null> => {
    const contract = getAddress(token.address) as Address;
    try {
      const [raw, decimals, symbol, name] = await Promise.all([
        client.readContract({ address: contract, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }) as Promise<bigint>,
        client.readContract({ address: contract, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
        client.readContract({ address: contract, abi: ERC20_ABI, functionName: "symbol" }).catch(() => null) as Promise<string | null>,
        client.readContract({ address: contract, abi: ERC20_ABI, functionName: "name" }).catch(() => null) as Promise<string | null>,
      ]);
      const safeDecimals = Number(decimals);
      const scale = Number.isInteger(safeDecimals) && safeDecimals >= 0 && safeDecimals <= 36 ? safeDecimals : 18;
      return {
        address: contract,
        symbol: sanitizeTokenText(symbol, token.label ?? "TOKEN", 16),
        name: sanitizeTokenText(name, token.label ?? "Token", 48),
        decimals: scale,
        raw: raw.toString(),
        formatted: tidyAmount(formatUnits(raw, scale)),
        configured: token.configured,
        verifiedUrl: token.verifiedUrl,
      };
    } catch {
      // A single unreadable token must not fail the whole snapshot.
      return null;
    }
  }));

  return { ok: true, data: results.filter((item): item is TokenHolding => item !== null), updatedAt: Date.now(), stale: false };
}