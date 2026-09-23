import "server-only";

import { getAddress, isAddress, type Address } from "viem";

export type NormalizedWalletAddress = {
  address: Address;
  uniqueKey: string;
};

/**
 * Validates an EVM address with viem and returns one canonical representation
 * for display plus a case-insensitive key for database uniqueness/lookups.
 */
export function normalizeWalletAddress(value: unknown): NormalizedWalletAddress {
  if (typeof value !== "string") throw new Error("INVALID_WALLET_ADDRESS");
  const candidate = value.trim();
  if (!isAddress(candidate, { strict: true })) throw new Error("INVALID_WALLET_ADDRESS");
  const address = getAddress(candidate);
  return { address, uniqueKey: address.toLowerCase() };
}

