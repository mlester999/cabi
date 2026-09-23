import {
  normalizeTradeAddress,
  parseClankTradeUrl,
  type TradeAction,
  type TradeAmountType,
  type TradeIntent,
} from "@/lib/trading/types";
import { z } from "zod";

/**
 * The intent boundary.
 *
 * A language model may only ever emit JSON matching this schema. There is no
 * calldata field, no gas field, no recipient field, and no "execute" flag, so a
 * prompt-injected model cannot express a transaction here even in principle.
 * Unknown keys are rejected rather than passed through.
 */
export const tradeIntentSchema = z.object({
  action: z.enum(["BUY", "SELL", "OPEN_TOKEN", "COPY_CONTRACT", "SWITCH_NETWORK", "SHOW_TOKEN"]),
  tokenAddress: z.string().trim().max(120).optional(),
  tokenSymbol: z.string().trim().max(24).optional(),
  amountType: z.enum(["NATIVE", "TOKEN", "PERCENTAGE"]).optional(),
  amount: z.string().trim().max(40).optional(),
  chainId: z.number().int().positive().max(2_147_483_647).optional(),
  source: z.literal("CLANK_TRADE").optional(),
}).strict();

export type ParsedTradeIntent =
  | { status: "valid"; intent: TradeIntent }
  | { status: "invalid"; reason: "MALFORMED" | "CALLDATA_REJECTED" };

/**
 * Field names that must never appear in model output. Any of these is treated as
 * an injection attempt rather than being stripped.
 */
const forbiddenKeys = [
  "data", "calldata", "input", "to", "from", "value", "gas", "gaslimit", "gasprice",
  "maxfeepergas", "maxpriorityfeepergas", "nonce", "rawtransaction", "signedtransaction",
  "privatekey", "seedphrase", "mnemonic", "execute", "sendtransaction", "sendrawtransaction",
] as const;

const amountPattern = /^\d{1,30}(?:\.\d{1,18})?$/u;

/**
 * Validates raw model output into a `TradeIntent`.
 *
 * Anything malformed is rejected outright instead of being coerced, and any
 * transaction-shaped key is treated as an injection attempt.
 */
export function parseTradeIntent(raw: unknown): ParsedTradeIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "invalid", reason: "MALFORMED" };
  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if ((forbiddenKeys as readonly string[]).includes(key.toLowerCase())) {
      return { status: "invalid", reason: "CALLDATA_REJECTED" };
    }
  }

  const parsed = tradeIntentSchema.safeParse(record);
  if (!parsed.success) return { status: "invalid", reason: "MALFORMED" };

  const value = parsed.data;
  const intent: TradeIntent = { action: value.action as TradeAction, source: value.source };

  if (value.tokenAddress) {
    try {
      intent.tokenAddress = normalizeTradeAddress(value.tokenAddress);
    } catch {
      // A malformed address is dropped, not guessed at. The token then has to be
      // resolved by symbol or by an explicit choice from the user.
      return { status: "invalid", reason: "MALFORMED" };
    }
  }
  if (value.tokenSymbol) intent.tokenSymbol = value.tokenSymbol.replace(/^\$/u, "").toUpperCase();
  if (value.amountType) intent.amountType = value.amountType as TradeAmountType;
  if (value.amount) {
    if (!amountPattern.test(value.amount)) return { status: "invalid", reason: "MALFORMED" };
    intent.amount = value.amount;
  }
  if (value.chainId) intent.chainId = value.chainId;

  // A percentage must be within bounds; anything else would be a silently wrong
  // order size.
  if (intent.amountType === "PERCENTAGE") {
    const percent = Number(intent.amount);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { status: "invalid", reason: "MALFORMED" };
  }

  return { status: "valid", intent };
}

/**
 * Structural check that a prepared transaction is well-formed *and* consistent
 * with the intent it came from. This runs immediately before the wallet call.
 */
export function assertTransactionRequestMatchesIntent(
  transaction: { to: string; data: string; value: string; chainId: number },
  intent: TradeIntent,
): { ok: true } | { ok: false; reason: string } {
  try {
    normalizeTradeAddress(transaction.to);
  } catch {
    return { ok: false, reason: "The prepared transaction has an invalid target address." };
  }
  if (!/^0x[0-9a-fA-F]*$/u.test(transaction.data)) return { ok: false, reason: "The prepared transaction contains invalid calldata." };
  if (!/^\d+$/u.test(transaction.value)) return { ok: false, reason: "The prepared transaction contains an invalid value." };
  if (!Number.isSafeInteger(transaction.chainId) || transaction.chainId <= 0) return { ok: false, reason: "The prepared transaction targets an invalid chain." };

  if (intent.action === "COPY_CONTRACT" || intent.action === "OPEN_TOKEN" || intent.action === "SWITCH_NETWORK") {
    return { ok: false, reason: "That request never produces a transaction." };
  }
  if (intent.chainId != null && intent.chainId !== transaction.chainId) {
    return { ok: false, reason: "The prepared transaction targets a different network than the request." };
  }
  return { ok: true };
}

/** Only an absolute, HTTPS, exact-host Clank.trade URL may be opened for the user. */
export function assertClankLink(url: string): { ok: true; url: string } | { ok: false; reason: string } {
  const safe = parseClankTradeUrl(url);
  if (!safe) return { ok: false, reason: "Cabi only opens verified Clank.trade links." };
  return { ok: true, url: safe };
}

export const MAX_TRADE_AMOUNT_DECIMALS = 18;