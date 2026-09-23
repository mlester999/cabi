/**
 * Shared types for the trusted wallet read layer.
 *
 * Every value here is public onchain data. Nothing in this module may request,
 * hold, or transmit private key material.
 */

export type WalletDataError =
  | "WALLET_NOT_CONNECTED"
  | "UNSUPPORTED_CHAIN"
  | "RPC_UNAVAILABLE"
  | "INVALID_ADDRESS"
  | "TIMEOUT";

export type WalletDataResult<T> =
  | { ok: true; data: T; updatedAt: number; stale: boolean }
  | { ok: false; error: WalletDataError; message: string };

export type NativeBalance = {
  chainId: number;
  symbol: string;
  decimals: number;
  /** Raw base-unit value as a decimal string. */
  raw: string;
  /** Human-readable amount, trimmed. */
  formatted: string;
};

export type TokenHolding = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  raw: string;
  formatted: string;
  /** Present only when the token is one the owner configured (today: $CPU). */
  configured?: boolean;
  /** Exact verified coin page, when the owner published one. */
  verifiedUrl?: string;
};

export type WalletSnapshot = {
  address: string;
  chainId: number;
  chainName: string;
  native: NativeBalance | null;
  tokens: TokenHolding[];
  /** Chains the owner has enabled, for switching prompts. */
  supportedChains: Array<{ id: number; name: string; enabled: boolean }>;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerUrl: string | null;
};

export function shortAddress(address: string, leading = 6, trailing = 4) {
  if (address.length <= leading + trailing + 1) return address;
  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}