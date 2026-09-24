import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { hashValue } from "@/lib/security/crypto";

/**
 * Privacy-conscious holder-gate analytics.
 *
 * The events are intentionally coarse:
 *
 *   cpu_gate_viewed | cpu_gate_passed | cpu_gate_failed | cpu_buy_link_opened
 *
 * What is deliberately NOT recorded: balances, holding history, the wallet
 * address, or anything else that would turn a membership check into a record of
 * what a person owns. The actor is a salted hash of the already-internal
 * `wallet_account_id`, which is enough to count distinct wallets without storing
 * one. A missing table or database never blocks a request - analytics is a
 * side-channel, not part of the authorization path.
 */

export const cpuGateEvents = [
  "cpu_gate_viewed",
  "cpu_gate_passed",
  "cpu_gate_failed",
  "cpu_buy_link_opened",
] as const;

export type CpuGateEvent = (typeof cpuGateEvents)[number];

export function isCpuGateEvent(value: unknown): value is CpuGateEvent {
  return typeof value === "string" && (cpuGateEvents as readonly string[]).includes(value);
}

export async function recordCpuGateEvent(input: {
  event: CpuGateEvent;
  walletAccountId?: string | null;
  siteMode?: string;
}): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  try {
    await db.from("cpu_gate_events").insert({
      event: input.event,
      // Non-reversible and stable, so "distinct wallets" is countable without
      // keeping an address or a balance anywhere.
      actor_hash: input.walletAccountId ? await hashValue(`cpu_gate:${input.walletAccountId}`) : null,
      site_mode: input.siteMode ?? null,
    });
  } catch {
    // Never surface an analytics failure to the user.
  }
}
