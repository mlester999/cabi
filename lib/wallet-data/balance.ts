import "server-only";

import { createPublicClient, formatUnits, http, isAddress, getAddress, type Address } from "viem";

import { assertUsableChain } from "@/lib/wallet-data/chain";
import type { NativeBalance, WalletDataResult } from "@/lib/wallet-data/types";
import type { SupportedChainConfig } from "@/lib/wallet/config";

const RPC_TIMEOUT_MS = 8_000;

function clientFor(chain: SupportedChainConfig) {
  return createPublicClient({
    transport: http(chain.rpcUrl, { retryCount: 1, timeout: RPC_TIMEOUT_MS }),
  });
}

/** Trims a formatted decimal string without losing precision. */
export function tidyAmount(value: string, maxDecimals = 6) {
  if (!value.includes(".")) return value;
  const [whole, fraction] = value.split(".");
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/u, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Reads the native balance for one address on one verified chain.
 *
 * This is the ONLY place native balance is fetched. Chat, the portfolio route,
 * and any future surface all call through here so RPC handling, timeouts, and
 * error mapping stay in one place.
 */
export async function readNativeBalance(
  chain: SupportedChainConfig | undefined,
  address: string,
  options: { client?: ReturnType<typeof clientFor> } = {},
): Promise<WalletDataResult<NativeBalance>> {
  const usable = assertUsableChain(chain);
  if (!usable.ok) return { ok: false, error: "UNSUPPORTED_CHAIN", message: usable.reason };
  if (!isAddress(address, { strict: false })) return { ok: false, error: "INVALID_ADDRESS", message: "That wallet address isn't valid." };

  try {
    const client = options.client ?? clientFor(usable.chain);
    const raw = await client.getBalance({ address: getAddress(address.toLowerCase()) as Address });
    const decimals = usable.chain.nativeCurrency.decimals;
    return {
      ok: true,
      data: {
        chainId: usable.chain.id,
        symbol: usable.chain.nativeCurrency.symbol,
        decimals,
        raw: raw.toString(),
        formatted: tidyAmount(formatUnits(raw, decimals)),
      },
      updatedAt: Date.now(),
      stale: false,
    };
  } catch {
    return { ok: false, error: "RPC_UNAVAILABLE", message: "I couldn't read your wallet right now." };
  }
}