import "server-only";

import { createPublicClient, getAddress, http, isAddress } from "viem";

import { createTtlCache, tokenMetadataTtlMs } from "@/lib/wallet-data/cache";
import { sanitizeTokenText } from "@/lib/wallet-data/tokens";
import { assertUsableChain } from "@/lib/wallet-data/chain";
import { explorerAddressUrlFor } from "@/lib/wallet-data/chain";
import { getPublicWalletConfig, type PublicWalletConfig, type SupportedChainConfig } from "@/lib/wallet/config";

/**
 * Token metadata resolution.
 *
 * One trusted path answers "what token is this?" for every surface (chat cards,
 * the action layer, the portfolio). Resolution order is deliberate:
 *
 * 1. An explicit contract address  -  always wins, because it is unambiguous.
 * 2. Owner configuration ($CPU)  -  authoritative for the project's own token.
 * 3. Onchain `name`/`symbol`/`decimals` read through the owner's configured RPC.
 *
 * Nothing here invents a price, market cap, holder count, or bonding curve. This
 * repository has no verified market-data source, so those fields do not exist in
 * the model at all rather than being filled with a placeholder.
 */

const ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

const metadataCache = createTtlCache<TokenMetadata>(tokenMetadataTtlMs);
const RPC_TIMEOUT_MS = 8_000;

export type TokenMetadata = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number | null;
  chainName: string | null;
  /** True when this is the owner-configured project token. */
  isConfiguredCpu: boolean;
  /** Exact verified coin page, only when the owner published one. */
  clankTradeUrl: string | null;
  explorerUrl: string | null;
  /** Where the metadata came from, so the UI can be honest about trust. */
  origin: "CONFIGURED" | "ONCHAIN" | "UNRESOLVED";
  /** Present when metadata could not be read, so the UI can say so. */
  unavailableReason?: string;
};

/** Case-insensitive index of the owner's configured $CPU contract. */
function configuredEntries(config: PublicWalletConfig, chain: SupportedChainConfig | undefined) {
  const cpu = config.cpu;
  if (!cpu.contractAddress || !isAddress(cpu.contractAddress, { strict: false })) return null;
  return {
    address: getAddress(cpu.contractAddress.toLowerCase()),
    cpu,
    chain,
  };
}

function fromConfigured(config: PublicWalletConfig, chain: SupportedChainConfig | undefined): TokenMetadata | null {
  const entry = configuredEntries(config, chain);
  if (!entry) return null;
  const { cpu } = entry;
  return {
    address: entry.address,
    symbol: sanitizeTokenText(cpu.ticker, "CPU", 16),
    name: sanitizeTokenText(cpu.tokenName, "Cat Partner Unit", 48),
    decimals: chain?.nativeCurrency.decimals ?? 18,
    chainId: cpu.chainId,
    chainName: chain?.name ?? null,
    isConfiguredCpu: true,
    clankTradeUrl: cpu.clankTradeUrl || null,
    explorerUrl: cpu.explorerUrl || explorerAddressUrlFor(chain, entry.address),
    origin: "CONFIGURED",
  };
}

/** Reads metadata straight from the contract. Never throws. */
async function fromOnchain(address: string, chain: SupportedChainConfig | undefined): Promise<TokenMetadata> {
  const base: TokenMetadata = {
    address: getAddress(address.toLowerCase()),
    symbol: "",
    name: "",
    decimals: 18,
    chainId: chain?.id ?? null,
    chainName: chain?.name ?? null,
    isConfiguredCpu: false,
    clankTradeUrl: null,
    explorerUrl: explorerAddressUrlFor(chain, address),
    origin: "UNRESOLVED",
  };

  const usable = assertUsableChain(chain);
  if (!usable.ok) return { ...base, unavailableReason: "No EVM network is configured, so I can't read token details." };

  try {
    const client = createPublicClient({ transport: http(usable.chain.rpcUrl, { retryCount: 1, timeout: RPC_TIMEOUT_MS }) });
    const contract = getAddress(address.toLowerCase());
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address: contract, abi: ABI, functionName: "name" }).catch(() => null) as Promise<string | null>,
      client.readContract({ address: contract, abi: ABI, functionName: "symbol" }).catch(() => null) as Promise<string | null>,
      client.readContract({ address: contract, abi: ABI, functionName: "decimals" }).catch(() => null) as Promise<number | null>,
    ]);
    if (name === null && symbol === null && decimals === null) {
      return { ...base, unavailableReason: "That contract didn't answer as a token, so I can't confirm what it is." };
    }
    const rawDecimals = Number(decimals);
    return {
      ...base,
      symbol: sanitizeTokenText(symbol, "TOKEN", 16),
      name: sanitizeTokenText(name, "Unverified token", 48),
      decimals: Number.isInteger(rawDecimals) && rawDecimals >= 0 && rawDecimals <= 36 ? rawDecimals : 18,
      origin: "ONCHAIN",
    };
  } catch {
    return { ...base, unavailableReason: "I couldn't reach the network to read that token." };
  }
}

/**
 * Resolves token metadata for an explicit contract address.
 *
 * The owner-configured token short-circuits the RPC read so $CPU always shows
 * the owner's published name, ticker, and verified link rather than whatever the
 * contract happens to return.
 */
export async function resolveTokenMetadata(
  address: string,
  options: { config?: PublicWalletConfig; fresh?: boolean } = {},
): Promise<TokenMetadata | null> {
  if (!isAddress(address, { strict: false })) return null;
  const normalized = getAddress(address.toLowerCase());
  const config = options.config ?? await getPublicWalletConfig();
  const enabled = config.chains.filter((chain) => chain.enabled);

  const configured = fromConfigured(config, enabled.find((chain) => chain.id === config.cpu.chainId) ?? enabled[0]);
  if (configured && configured.address === normalized) return configured;

  const key = `meta:${normalized}`;
  if (!options.fresh) {
    const hit = metadataCache.get(key);
    if (hit) return hit.value;
  }

  const chain = enabled.find((candidate) => candidate.id === config.primaryChainId) ?? enabled[0];
  const resolved = await fromOnchain(normalized, chain);
  // Only cache a successful read; a transient RPC failure should be retried.
  if (resolved.origin === "ONCHAIN") metadataCache.set(key, resolved);
  return resolved;
}

/** The owner-configured $CPU metadata, or null when it is not published yet. */
export async function resolveConfiguredCpu(config?: PublicWalletConfig): Promise<TokenMetadata | null> {
  const resolved = config ?? await getPublicWalletConfig();
  const chain = resolved.chains.find((candidate) => candidate.id === resolved.cpu.chainId && candidate.enabled)
    ?? resolved.chains.find((candidate) => candidate.enabled);
  return fromConfigured(resolved, chain);
}

export function clearTokenMetadataCache() {
  metadataCache.clear();
}