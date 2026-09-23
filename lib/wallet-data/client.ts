import "server-only";

import { isAddress, getAddress } from "viem";

import { readNativeBalance, tidyAmount } from "@/lib/wallet-data/balance";
import { explorerAddressUrlFor, chainById } from "@/lib/wallet-data/chain";
import { configuredTokens, readTokenHoldings } from "@/lib/wallet-data/tokens";
import { createTtlCache, walletSnapshotTtlMs } from "@/lib/wallet-data/cache";
import type { NativeBalance, TokenHolding, WalletDataResult, WalletSnapshot } from "@/lib/wallet-data/types";
import { getPublicWalletConfig, type PublicWalletConfig } from "@/lib/wallet/config";

/**
 * The trusted wallet read layer.
 *
 * Everything that needs to know about a wallet's public onchain state goes
 * through `readWalletSnapshot`. Chat and the portfolio route share this one
 * implementation, so RPC handling, timeout behaviour, error mapping, and caching
 * cannot drift between surfaces.
 *
 * Two rules hold here:
 *
 * 1. Chain configuration always comes from the owner's admin settings, never
 *    from a request parameter, so a caller cannot redirect an RPC call.
 * 2. The address is supplied by the caller from a verified session  -  this module
 *    never infers an owner, so it cannot be used to read someone else's wallet
 *    on another user's behalf.
 */

const snapshotCache = createTtlCache<WalletSnapshot>(walletSnapshotTtlMs);

function cacheKey(address: string, chainId: number) {
  return `${chainId}:${address.toLowerCase()}`;
}

export async function readWalletSnapshot(input: {
  address: string | null | undefined;
  chainId: number | null | undefined;
  config?: PublicWalletConfig;
  /** Bypass the cache, for an explicit user refresh. */
  fresh?: boolean;
}): Promise<WalletDataResult<WalletSnapshot>> {
  if (!input.address || !isAddress(input.address, { strict: false })) {
    return { ok: false, error: "WALLET_NOT_CONNECTED", message: "Connect your wallet first and I can check." };
  }
  const address = getAddress(input.address.toLowerCase());

  const config = input.config ?? await getPublicWalletConfig();
  const enabled = config.chains.filter((chain) => chain.enabled);

  // Prefer the chain the wallet is actually on, but only if the owner enabled it.
  const chain = chainById(enabled, input.chainId) ?? chainById(enabled, config.primaryChainId) ?? enabled[0];
  if (!chain) {
    return { ok: false, error: "UNSUPPORTED_CHAIN", message: "No EVM network is configured for Cabi yet." };
  }

  const key = cacheKey(address, chain.id);
  if (!input.fresh) {
    const hit = snapshotCache.get(key);
    if (hit) return { ok: true, data: hit.value, updatedAt: Date.now() - hit.age, stale: true };
  }

  const [nativeResult, tokenResult] = await Promise.all([
    readNativeBalance(chain, address),
    readTokenHoldings(chain, address, configuredTokens(config.cpu)),
  ]);

  // A wallet with a readable chain but an unreadable native balance is still
  // worth showing, so the snapshot degrades rather than failing outright.
  const native: NativeBalance | null = nativeResult.ok ? nativeResult.data : null;
  const tokens: TokenHolding[] = tokenResult.ok ? tokenResult.data : [];

  if (!nativeResult.ok && !tokenResult.ok) {
    return { ok: false, error: nativeResult.error, message: nativeResult.message };
  }

  const snapshot: WalletSnapshot = {
    address,
    chainId: chain.id,
    chainName: chain.name,
    native,
    tokens,
    supportedChains: config.chains.map((item) => ({ id: item.id, name: item.name, enabled: item.enabled })),
    nativeCurrency: chain.nativeCurrency,
    explorerUrl: explorerAddressUrlFor(chain, address),
  };

  snapshotCache.set(key, snapshot);
  return { ok: true, data: snapshot, updatedAt: Date.now(), stale: false };
}

/** Clears cached snapshots; used after a wallet action so the next read is fresh. */
export function invalidateWalletSnapshot(address?: string) {
  if (!address) {
    snapshotCache.clear();
    return;
  }
  const lowered = address.toLowerCase();
  snapshotCache.deleteWhere((key) => key.endsWith(`:${lowered}`));
}

/** Finds one configured token holding inside a snapshot, matched by address. */
export function findTokenHolding(snapshot: WalletSnapshot, address: string): TokenHolding | undefined {
  if (!isAddress(address, { strict: false })) return undefined;
  const wanted = getAddress(address.toLowerCase());
  return snapshot.tokens.find((token) => getAddress(token.address) === wanted);
}

export { tidyAmount };