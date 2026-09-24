import "server-only";

import { isCpuGateBlocked, type RuntimeCabiAccess } from "@/lib/cpu-access/resolve";

/**
 * The browser-facing shape of a holder-gate decision.
 *
 * Everything here is display-only. The authorization itself was decided on the
 * server from the raw bigint balance, which is never serialized: the browser
 * receives text and booleans and cannot turn either back into access. There is
 * deliberately no field a client could post back to change a decision.
 */
export type CpuHolderStatus = {
  allowed: boolean;
  reason: string;
  live: boolean;
  cpuGateBypassed: boolean;
  walletAddress: string | null;
  balance: string | null;
  balanceTruncated: boolean;
  required: string | null;
  deficit: string | null;
  symbol: string | null;
  message: string | null;
  buyUrl: string | null;
};

export function cpuHolderStatusPayload(decision: RuntimeCabiAccess, buyUrl?: string | null): CpuHolderStatus {
  const gate = isCpuGateBlocked(decision) ? decision.gate : null;
  return {
    allowed: decision.allowed,
    reason: decision.reason,
    live: decision.live,
    cpuGateBypassed: decision.allowed ? decision.cpuGateBypassed : false,
    walletAddress: gate?.walletAddress ?? null,
    balance: gate?.numbers?.balance ?? null,
    balanceTruncated: gate?.numbers?.balanceTruncated ?? false,
    required: gate?.numbers?.required ?? null,
    deficit: gate?.numbers?.deficit ?? null,
    symbol: gate?.numbers?.symbol ?? null,
    message: gate?.message ?? null,
    buyUrl: gate?.buyUrl ?? buyUrl ?? null,
  };
}
