import { getAddress, isAddress } from "viem";

/**
 * The structured trade intent.
 *
 * This is the ONLY thing a language model is ever allowed to produce. It is a
 * description of what the user asked for - never calldata, never a gas value,
 * never a target contract. Trusted application code turns a validated intent
 * into either a provider-built transaction or a verified external link.
 */
export type TradeAction = "BUY" | "SELL" | "OPEN_TOKEN" | "COPY_CONTRACT" | "SWITCH_NETWORK" | "SHOW_TOKEN";

export type TradeAmountType = "NATIVE" | "TOKEN" | "PERCENTAGE";

export type TradeSource = "CLANK_TRADE";

export type TradeIntent = {
  action: TradeAction;
  tokenAddress?: string;
  tokenSymbol?: string;
  amountType?: TradeAmountType;
  amount?: string;
  chainId?: number;
  source?: TradeSource;
};

/**
 * Raw model output. Every field is `unknown` because nothing coming back from a
 * model is trusted until `parseTradeIntent` has validated it.
 */
export type UnvalidatedTradeIntent = Record<string, unknown>;

/**
 * Every state the trade UI can be in. All of them are rendered, and the names
 * match the product specification exactly.
 */
export type TradeState =
  | "IDLE"
  | "INTENT_DETECTED"
  | "NEEDS_CLARIFICATION"
  | "FETCHING_QUOTE"
  | "QUOTE_READY"
  | "AWAITING_USER_CONFIRMATION"
  | "AWAITING_WALLET"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "REJECTED_BY_USER"
  | "EXPIRED_QUOTE"
  | "UNSUPPORTED";

export type TradeClarificationReason =
  | "AMBIGUOUS_TOKEN"
  | "AMBIGUOUS_AMOUNT"
  | "MISSING_TOKEN"
  | "MISSING_AMOUNT"
  | "UNSUPPORTED_ACTION";

export type TradeClarification = {
  reason: TradeClarificationReason;
  question: string;
  candidates?: TokenCandidate[];
};

export type TokenCandidate = {
  address: string;
  symbol: string;
  name: string;
  chainId: number;
  /** Where the candidate came from, so the user can judge trust. */
  origin: "CLANK_TRADE" | "USER_PROVIDED" | "CONFIGURED";
  /** Exact verified page for this coin, when the provider can supply one. */
  verifiedUrl?: string;
};

export type ResolvedToken = TokenCandidate & { verified: boolean };

/**
 * A quote is optional. `null` means "no real quote exists", and the UI must then
 * omit the estimated receive / network fee rows entirely rather than guessing.
 */
export type TradeQuote = {
  amountIn: string;
  amountOut: string | null;
  amountOutMinimum?: string | null;
  priceImpactPercent: number | null;
  networkFeeNative: string | null;
  route: string;
  provider: TradeSource;
  /** Milliseconds since epoch. A quote past this is EXPIRED_QUOTE. */
  expiresAt: number;
};

/**
 * The transaction request that trusted code hands to the wallet.
 *
 * The model never writes this. The provider adapter does, and
 * `assertTransactionRequestMatchesIntent` re-validates every field before it can
 * reach `eth_sendTransaction`.
 */
export type TransactionRequest = {
  to: string;
  data: string;
  value: string;
  chainId: number;
  /** Optional gas limit suggested by the provider. The wallet may replace it. */
  gas?: string;
};

export type TradeSummaryRow = { label: string; value: string; mono?: boolean; muted?: boolean };

export type PreparedTrade =
  | { kind: "TRANSACTION"; summary: TradeSummaryRow[]; transaction: TransactionRequest }
  | { kind: "EXTERNAL_LINK"; summary: TradeSummaryRow[]; url: string; label: string }
  | { kind: "WALLET_ONLY"; summary: TradeSummaryRow[]; chainId: number; label: string }
  | { kind: "COPY"; summary: TradeSummaryRow[]; value: string; label: string };

export const tradeStateLabels: Record<TradeState, string> = {
  IDLE: "Idle",
  INTENT_DETECTED: "Intent detected",
  NEEDS_CLARIFICATION: "Needs clarification",
  FETCHING_QUOTE: "Fetching quote",
  QUOTE_READY: "Quote ready",
  AWAITING_USER_CONFIRMATION: "Waiting for your confirmation",
  AWAITING_WALLET: "Waiting for your wallet",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  FAILED: "Failed",
  REJECTED_BY_USER: "Cancelled in wallet",
  EXPIRED_QUOTE: "Quote expired",
  UNSUPPORTED: "Not supported yet",
};

/** States in which a transaction may be handed to the wallet. */
export const walletSubmittableStates: readonly TradeState[] = ["AWAITING_WALLET"] as const;

export function isTerminalTradeState(state: TradeState) {
  return state === "CONFIRMED" || state === "FAILED" || state === "REJECTED_BY_USER" || state === "EXPIRED_QUOTE" || state === "UNSUPPORTED";
}

/**
 * Normalises an EVM address. Throws on anything that is not address-shaped, so a
 * malformed value can never be forwarded to a wallet.
 */
export function normalizeTradeAddress(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new Error("INVALID_ADDRESS");
  return getAddress(value.toLowerCase());
}

/**
 * A coin page URL is only ever opened when it is an absolute HTTPS Clank.trade
 * link. This blocks `javascript:`, relative paths, lookalike hosts, and
 * credential-bearing URLs from reaching `window.open`.
 */
export const clankTradeHosts: readonly string[] = ["clank.trade", "www.clank.trade"] as const;

export function parseClankTradeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!clankTradeHosts.includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}