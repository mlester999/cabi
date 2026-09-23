import { normalizeTradeAddress, type ResolvedToken, type TradeIntent, type TradeQuote, type TransactionRequest } from "@/lib/trading/types";

/**
 * Trading provider abstraction.
 *
 * Cabi must not guess at undocumented Clank.trade interfaces. Everything the
 * application needs from a trade venue goes through this interface, and the
 * shipped implementation (`clankTrade.ts`) is deliberately a *link* provider: it
 * resolves tokens, prepares a verified external page, and reports
 * `supportsDirectTransactions: false`. A future, documented integration can
 * implement `getQuote` / `prepareBuy` / `prepareSell` without any change to the
 * intent layer, the UI states, or the wallet safety rules.
 */
export interface TradingProvider {
  readonly id: "CLANK_TRADE";
  readonly label: string;
  /** False until a documented, verifiable transaction interface exists. */
  readonly supportsDirectTransactions: boolean;

  resolveToken(input: { address?: string; symbol?: string; chainId?: number | null }): Promise<ResolvedToken[]>;
  getQuote(intent: TradeIntent, token: ResolvedToken): Promise<TradeQuote | null>;
  prepareBuy(intent: TradeIntent, token: ResolvedToken, quote: TradeQuote | null): Promise<TransactionRequest | null>;
  prepareSell(intent: TradeIntent, token: ResolvedToken, quote: TradeQuote | null): Promise<TransactionRequest | null>;
  /** Exact verified coin page, when the provider can produce one. */
  tokenPageUrl(token: Pick<ResolvedToken, "address" | "verifiedUrl">): string | null;
}

export type PreparedTransactionInput = {
  chainId: number;
  to: string;
  data: string;
  value: string;
  gas?: string;
};

/**
 * The one and only way a transaction request enters the application.
 *
 * It normalises the target address, enforces hex calldata and integer value, and
 * refuses anything malformed. Model output never reaches this function without
 * having passed `parseTradeIntent` and `assertTransactionRequestMatchesIntent`
 * first.
 */
export function buildTransactionRequest(input: PreparedTransactionInput): TransactionRequest {
  const to = normalizeTradeAddress(input.to);
  if (!/^0x[0-9a-fA-F]*$/u.test(input.data)) throw new Error("INVALID_CALLDATA");
  if (!/^\d+$/u.test(input.value)) throw new Error("INVALID_VALUE");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("INVALID_CHAIN");
  if (input.gas !== undefined && !/^\d+$/u.test(input.gas)) throw new Error("INVALID_GAS");
  return { to, data: input.data, value: input.value, chainId: input.chainId, gas: input.gas };
}