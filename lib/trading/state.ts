import type { TradingProvider } from "@/lib/trading/provider";
import type { TradeClarification, TradeIntent, TradeState, TradeSummaryRow } from "@/lib/trading/types";
import { tradeStateLabels } from "@/lib/trading/types";
import { assertTransactionRequestMatchesIntent } from "@/lib/trading/validation";

/**
 * The trade lifecycle.
 *
 * Every transition is explicit and enumerated. The two invariants that matter
 * most are enforced here rather than in the UI:
 *
 * 1. `AWAITING_WALLET` is reachable only from `AWAITING_USER_CONFIRMATION`, so an
 *    intent the user has not confirmed can never reach a wallet.
 * 2. There is no automatic transition into `AWAITING_WALLET`. It requires a
 *    `CONFIRM` event, which only a user interaction produces.
 */
export type TradeEvent =
  | { type: "RESET" }
  | { type: "INTENT_DETECTED"; intent: TradeIntent }
  | { type: "NEEDS_CLARIFICATION"; clarification: TradeClarification }
  | { type: "FETCHING_QUOTE" }
  | { type: "QUOTE_READY"; summary: TradeSummaryRow[]; expiresAt?: number }
  | { type: "QUOTE_UNAVAILABLE"; summary: TradeSummaryRow[] }
  | { type: "AWAITING_USER_CONFIRMATION" }
  | { type: "CONFIRM" }
  | { type: "WALLET_REJECTED"; reason?: string }
  | { type: "SUBMITTED"; hash: string }
  | { type: "CONFIRMED"; hash?: string }
  | { type: "FAILED"; reason: string }
  | { type: "EXPIRED" }
  | { type: "UNSUPPORTED"; reason: string };

export type TradeSession = {
  state: TradeState;
  intent: TradeIntent | null;
  clarification: TradeClarification | null;
  summary: TradeSummaryRow[];
  /** True when the user has explicitly pressed the confirmation button. */
  confirmedByUser: boolean;
  quoteExpiresAt: number | null;
  hash: string | null;
  message: string | null;
};

export const initialTradeSession: TradeSession = {
  state: "IDLE",
  intent: null,
  clarification: null,
  summary: [],
  confirmedByUser: false,
  quoteExpiresAt: null,
  hash: null,
  message: null,
};

const allowedTransitions: Record<TradeState, readonly TradeState[]> = {
  IDLE: ["INTENT_DETECTED", "NEEDS_CLARIFICATION", "UNSUPPORTED"],
  INTENT_DETECTED: ["NEEDS_CLARIFICATION", "FETCHING_QUOTE", "UNSUPPORTED", "IDLE"],
  NEEDS_CLARIFICATION: ["INTENT_DETECTED", "IDLE", "UNSUPPORTED"],
  FETCHING_QUOTE: ["QUOTE_READY", "FAILED", "EXPIRED_QUOTE", "UNSUPPORTED", "IDLE"],
  QUOTE_READY: ["AWAITING_USER_CONFIRMATION", "EXPIRED_QUOTE", "IDLE"],
  AWAITING_USER_CONFIRMATION: ["AWAITING_WALLET", "IDLE", "EXPIRED_QUOTE"],
  AWAITING_WALLET: ["SUBMITTED", "REJECTED_BY_USER", "FAILED", "IDLE"],
  SUBMITTED: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["IDLE"],
  FAILED: ["IDLE", "AWAITING_USER_CONFIRMATION"],
  REJECTED_BY_USER: ["IDLE", "AWAITING_USER_CONFIRMATION"],
  EXPIRED_QUOTE: ["IDLE", "FETCHING_QUOTE"],
  UNSUPPORTED: ["IDLE"],
};

export function canTransition(from: TradeState, to: TradeState) {
  return allowedTransitions[from].includes(to);
}

export function tradeReducer(session: TradeSession, event: TradeEvent): TradeSession {
  if (event.type === "RESET") return initialTradeSession;

  const target: TradeState | null =
    event.type === "INTENT_DETECTED" ? "INTENT_DETECTED"
    : event.type === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION"
    : event.type === "FETCHING_QUOTE" ? "FETCHING_QUOTE"
    : event.type === "QUOTE_READY" || event.type === "QUOTE_UNAVAILABLE" ? "QUOTE_READY"
    : event.type === "AWAITING_USER_CONFIRMATION" ? "AWAITING_USER_CONFIRMATION"
    : event.type === "CONFIRM" ? "AWAITING_WALLET"
    : event.type === "WALLET_REJECTED" ? "REJECTED_BY_USER"
    : event.type === "SUBMITTED" ? "SUBMITTED"
    : event.type === "CONFIRMED" ? "CONFIRMED"
    : event.type === "FAILED" ? "FAILED"
    : event.type === "EXPIRED" ? "EXPIRED_QUOTE"
    : event.type === "UNSUPPORTED" ? "UNSUPPORTED"
    : null;

  if (!target) return session;
  if (!canTransition(session.state, target)) return session;

  switch (event.type) {
    case "INTENT_DETECTED":
      return { ...initialTradeSession, state: "INTENT_DETECTED", intent: event.intent };
    case "NEEDS_CLARIFICATION":
      return { ...session, state: "NEEDS_CLARIFICATION", clarification: event.clarification, confirmedByUser: false };
    case "FETCHING_QUOTE":
      return { ...session, state: "FETCHING_QUOTE", clarification: null, summary: [], confirmedByUser: false };
    case "QUOTE_READY":
      return { ...session, state: "QUOTE_READY", summary: event.summary, quoteExpiresAt: event.expiresAt ?? null, message: null };
    case "QUOTE_UNAVAILABLE":
      return { ...session, state: "QUOTE_READY", summary: event.summary, quoteExpiresAt: null, message: "No live quote is available for this request." };
    case "AWAITING_USER_CONFIRMATION":
      return { ...session, state: "AWAITING_USER_CONFIRMATION", confirmedByUser: false };
    case "CONFIRM":
      // The single gate between "prepared" and "the wallet is showing this".
      return { ...session, state: "AWAITING_WALLET", confirmedByUser: true };
    case "WALLET_REJECTED":
      return { ...session, state: "REJECTED_BY_USER", confirmedByUser: false, message: event.reason ?? "You cancelled in your wallet. Nothing was sent." };
    case "SUBMITTED":
      return { ...session, state: "SUBMITTED", hash: event.hash };
    case "CONFIRMED":
      return { ...session, state: "CONFIRMED", hash: event.hash ?? session.hash };
    case "FAILED":
      return { ...session, state: "FAILED", message: event.reason };
    case "EXPIRED":
      return { ...session, state: "EXPIRED_QUOTE", confirmedByUser: false, message: "That quote expired. Ask me again for a fresh one." };
    case "UNSUPPORTED":
      return { ...session, state: "UNSUPPORTED", confirmedByUser: false, message: event.reason };
    default:
      return session;
  }
}

export function describeTradeState(state: TradeState) {
  return tradeStateLabels[state];
}

export type PreparedOutcome =
  | { kind: "EXTERNAL_LINK"; url: string; label: string }
  | { kind: "WALLET_ONLY"; chainId: number; label: string }
  | { kind: "NONE" };

/**
 * Builds the confirmation rows for a request.
 *
 * Rows are only added when a real value exists. There is no placeholder price, no
 * invented fee, and no fabricated receive amount.
 */
export async function prepareTradeSummary(
  intent: TradeIntent,
  provider: TradingProvider,
  options: { chainName?: string | null } = {},
): Promise<{ state: TradeState; summary: TradeSummaryRow[]; clarification: TradeClarification | null; prepared: PreparedOutcome }> {
  const rows: TradeSummaryRow[] = [];
  const chainName = options.chainName ?? null;

  if (intent.action === "SWITCH_NETWORK") {
    if (!chainName || intent.chainId == null) {
      return { state: "UNSUPPORTED", summary: [], clarification: null, prepared: { kind: "NONE" } };
    }
    rows.push({ label: "Network", value: chainName });
    return {
      state: "AWAITING_USER_CONFIRMATION",
      summary: rows,
      clarification: null,
      prepared: { kind: "WALLET_ONLY", chainId: intent.chainId, label: `Switch to ${chainName}` },
    };
  }

  const candidates = await provider.resolveToken({ address: intent.tokenAddress, symbol: intent.tokenSymbol, chainId: intent.chainId ?? null });

  if (candidates.length === 0) {
    return {
      state: "NEEDS_CLARIFICATION",
      summary: [],
      clarification: {
        reason: intent.tokenSymbol ? "AMBIGUOUS_TOKEN" : "MISSING_TOKEN",
        question: intent.tokenSymbol
          ? `I can't safely match $${intent.tokenSymbol} to one contract. Which address do you mean?`
          : "Which coin do you mean? Show me the Clank.trade page or paste the contract address.",
      },
      prepared: { kind: "NONE" },
    };
  }
  if (candidates.length > 1 && !intent.tokenAddress) {
    return {
      state: "NEEDS_CLARIFICATION",
      summary: [],
      clarification: {
        reason: "AMBIGUOUS_TOKEN",
        question: `More than one coin uses $${intent.tokenSymbol ?? "that ticker"}. Which contract address do you mean?`,
        candidates,
      },
      prepared: { kind: "NONE" },
    };
  }

  const token = candidates[0];
  rows.push({ label: "Token", value: token.symbol ? `$${token.symbol}` : "Unverified token" });
  rows.push({ label: "Contract", value: token.address, mono: true });
  if (intent.amount && intent.amountType) {
    rows.push({
      label: intent.action === "SELL" ? "Sell" : "Spend",
      value: intent.amountType === "PERCENTAGE" ? `${intent.amount}% of your balance` : `${intent.amount}${intent.amountType === "NATIVE" ? " (native)" : ""}`,
    });
  }
  if (chainName) rows.push({ label: "Network", value: chainName });
  rows.push({ label: "Route", value: provider.label });

  if (!provider.supportsDirectTransactions) {
    rows.push({ label: "Estimated receive", value: "Not available", muted: true });
    rows.push({ label: "Estimated network fee", value: "Not available", muted: true });
    const url = provider.tokenPageUrl(token);
    return {
      state: "UNSUPPORTED",
      summary: rows,
      clarification: null,
      prepared: url ? { kind: "EXTERNAL_LINK", url, label: `Open ${token.symbol ? `$${token.symbol}` : "this coin"} on ${provider.label}` } : { kind: "NONE" },
    };
  }

  const quote = await provider.getQuote(intent, token);
  if (quote?.amountOut) rows.push({ label: "Estimated receive", value: `${quote.amountOut} ${token.symbol}` });
  if (quote?.networkFeeNative) rows.push({ label: "Estimated network fee", value: `${quote.networkFeeNative} native` });

  const transaction = intent.action === "SELL"
    ? await provider.prepareSell(intent, token, quote)
    : await provider.prepareBuy(intent, token, quote);

  if (!transaction) return { state: "UNSUPPORTED", summary: rows, clarification: null, prepared: { kind: "NONE" } };

  const matches = assertTransactionRequestMatchesIntent(transaction, intent);
  if (!matches.ok) return { state: "FAILED", summary: rows, clarification: null, prepared: { kind: "NONE" } };

  return { state: "AWAITING_USER_CONFIRMATION", summary: rows, clarification: null, prepared: { kind: "NONE" } };
}