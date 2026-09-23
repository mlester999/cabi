import "server-only";

import type { SupportedChainConfig } from "@/lib/wallet/config";

/**
 * Validates a chain configuration before any RPC call is attempted.
 *
 * The RPC URL comes from the owner's admin configuration, never from a request,
 * so there is no way for a caller to point this layer at an arbitrary endpoint.
 * This is still validated defensively: HTTPS only, no embedded credentials, and
 * a positive integer chain ID.
 */
export function assertUsableChain(chain: SupportedChainConfig | undefined | null):
  | { ok: true; chain: SupportedChainConfig }
  | { ok: false; reason: string } {
  if (!chain) return { ok: false, reason: "That network isn't configured yet." };
  if (!chain.enabled) return { ok: false, reason: "That network is turned off." };
  if (!Number.isSafeInteger(chain.id) || chain.id <= 0) return { ok: false, reason: "That network has an invalid chain ID." };
  let url: URL;
  try {
    url = new URL(chain.rpcUrl);
  } catch {
    return { ok: false, reason: "That network has an invalid RPC URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "That network's RPC must use HTTPS." };
  if (url.username || url.password) return { ok: false, reason: "That network's RPC URL must not contain credentials." };
  return { ok: true, chain };
}

export function chainById(chains: SupportedChainConfig[], chainId: number | null | undefined) {
  if (chainId == null) return undefined;
  return chains.find((chain) => chain.id === chainId);
}

export function explorerAddressUrlFor(chain: SupportedChainConfig | undefined, address: string) {
  if (!chain?.blockExplorerUrl) return null;
  return `${chain.blockExplorerUrl.replace(/\/$/u, "")}/address/${address}`;
}