import {
  normalizeTradeAddress,
  parseClankTradeUrl,
  type TradeAction,
  type TradeAmountType,
  type TradeClarification,
  type TradeIntent,
  type TradeSource,
} from "@/lib/trading/types";

/**
 * Natural-language intent extraction.
 *
 * This deterministic extractor is the *only* thing that may turn a chat message
 * into a `TradeIntent`. A language model may be asked for the same structured
 * object, but its output must pass `parseTradeIntent` in `validation.ts` - which
 * has no field for calldata, gas, or a recipient. Either way the model's job ends
 * at "what did the user ask for", never "what transaction do we send".
 */
export type IntentExtraction =
  | { status: "none" }
  | { status: "intent"; intent: TradeIntent; needs: TradeClarification["reason"][] }
  | { status: "clarify"; clarification: TradeClarification }
  | { status: "unsupported"; reason: string };

const nativeSymbols = ["eth", "ethereum", "native", "bnb", "matic", "pol", "avax"] as const;

/** Requests that must be refused outright rather than processed. */
const forbiddenPromptPattern = /\b(seed phrase|mnemonic|recovery phrase|private key|keystore|passphrase)\b/iu;

type ParsedAmount = { amountType: TradeAmountType; amount: string };

function parseAmount(raw: string | undefined): ParsedAmount | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/,/gu, "");
  const percent = value.match(/^(\d{1,3}(?:\.\d{1,4})?)\s*%$/u);
  if (percent) {
    const numeric = Number(percent[1]);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) return null;
    return { amountType: "PERCENTAGE", amount: percent[1] };
  }
  const numeric = value.match(/^(\d{1,30}(?:\.\d{1,18})?)$/u);
  if (!numeric) return null;
  return { amountType: "TOKEN", amount: numeric[1] };
}

function extractAddress(message: string) {
  const match = message.match(/0x[0-9a-fA-F]{40}/u);
  if (!match) return undefined;
  try { return normalizeTradeAddress(match[0]); } catch { return undefined; }
}

/** Normalises an address that came from application state rather than the user. */
function normalizeContextAddress(value: string | undefined) {
  if (!value) return undefined;
  try { return normalizeTradeAddress(value); } catch { return undefined; }
}

function extractUrl(message: string) {
  const match = message.match(/https:\/\/[^\s)>\]]+/u);
  if (!match) return undefined;
  return parseClankTradeUrl(match[0]) ?? undefined;
}

function extractSymbol(message: string) {
  const match = message.match(/\$([A-Za-z][A-Za-z0-9]{0,15})\b/u) ?? message.match(/\b(?:of|for)\s+([A-Z]{2,12})\b/u);
  return match ? match[1].toUpperCase() : undefined;
}

const references = /\b(this|that|it|the same)\b/u;

/**
 * Extracts a structured intent from one user message.
 *
 * `context` carries the coin the user is currently looking at, so "buy 0.02 eth
 * of this coin" can be resolved without guessing - and *only* from an explicit
 * on-screen selection, never from a bare ticker.
 */
export function extractTradeIntent(
  message: string,
  context: { selectedToken?: { address: string; symbol: string; chainId: number; verifiedUrl?: string }; chainId?: number | null } = {},
): IntentExtraction {
  const text = message.trim();
  if (!text || text.length > 1_500) return { status: "none" };

  // A user pasting a secret is redirected, never processed as a trade request.
  if (forbiddenPromptPattern.test(text)) {
    return { status: "unsupported", reason: "Cabi never asks for and never handles seed phrases or private keys." };
  }

  const address = extractAddress(text);
  const url = extractUrl(text);
  const symbol = extractSymbol(text);
  const chainId = context.chainId ?? undefined;
  const source: TradeSource = "CLANK_TRADE";
  const wantsThisCoin = references.test(text);
  const selectedAddress = normalizeContextAddress(context.selectedToken?.address);
  const selectedSymbol = context.selectedToken?.symbol?.replace(/^\$/u, "").toUpperCase();
  // An explicit address, or the coin the user is looking at, is unambiguous. A
  // bare ticker is not: many tokens share one symbol.
  const explicitAddress = address ?? (wantsThisCoin ? selectedAddress : undefined);
  const effectiveSymbol = explicitAddress ? (address ? symbol : selectedSymbol ?? symbol) : symbol;
  const symbolIsUnambiguous = !effectiveSymbol || effectiveSymbol === "CPU";

  // --- Wallet / network management -----------------------------------------
  if (/\b(switch|change)\b[^.]*\b(network|chain)\b/iu.test(text) || /\bwrong network\b/iu.test(text)) {
    if (!chainId) {
      return { status: "clarify", clarification: { reason: "UNSUPPORTED_ACTION", question: "Which network should I switch you to? None is configured yet." } };
    }
    return { status: "intent", intent: { action: "SWITCH_NETWORK", chainId, source }, needs: [] };
  }

  // --- Contract copy / explorer --------------------------------------------
  if (/\b(show|what(?:'s| is)?|give|copy|send)\b[^.]*\b(contract|address|ca)\b/iu.test(text)) {
    const target = address ?? selectedAddress ?? null;
    if (!target) {
      return { status: "clarify", clarification: { reason: "MISSING_TOKEN", question: "Which coin's contract should I show you?" } };
    }
    return {
      status: "intent",
      intent: { action: "COPY_CONTRACT", tokenAddress: target, tokenSymbol: selectedSymbol ?? symbol, chainId, source },
      needs: [],
    };
  }

  // --- Open on Clank.trade --------------------------------------------------
  if (/\bopen\b/iu.test(text) && /\b(clank|clank\.trade|coin|token|page)\b/iu.test(text)) {
    const target = address ?? selectedAddress ?? null;
    if (!target) {
      return { status: "clarify", clarification: { reason: "MISSING_TOKEN", question: "Which coin should I open on Clank.trade?" } };
    }
    return {
      status: "intent",
      intent: { action: "OPEN_TOKEN", tokenAddress: target, tokenSymbol: selectedSymbol ?? symbol, chainId, source },
      needs: [],
    };
  }

  // --- Buy ------------------------------------------------------------------
  if (/\b(buy|ape|snipe|purchase|grab)\b/iu.test(text)) {
    const spendMatch = text.match(/\b(\d{1,30}(?:\.\d{1,18})?)\s*(eth|bnb|matic|pol|avax|native)\b/iu);
    const plainMatch = text.match(/\b(\d{1,30}(?:\.\d{1,18})?)\b/u);
    const amount = spendMatch ? parseAmount(spendMatch[1]) : parseAmount(plainMatch?.[1]);
    const amountType: TradeAmountType | undefined = spendMatch ? "NATIVE" : amount?.amountType;

    const intent: TradeIntent = {
      action: "BUY",
      source,
      chainId,
      ...(explicitAddress ? { tokenAddress: explicitAddress } : {}),
      ...(effectiveSymbol ? { tokenSymbol: effectiveSymbol } : {}),
      ...(amount ? { amount: amount.amount, amountType } : {}),
    };
    const needs: TradeClarification["reason"][] = [];
    if (!explicitAddress && !symbolIsUnambiguous) needs.push("MISSING_TOKEN");
    if (!amount) needs.push("MISSING_AMOUNT");
    return { status: "intent", intent, needs };
  }

  // --- Sell -----------------------------------------------------------------
  if (/\b(sell|dump|exit|close)\b/iu.test(text)) {
    const percentMatch = text.match(/\b(\d{1,3}(?:\.\d{1,4})?)\s*%/u);
    const amountMatch = text.match(/\b(\d{1,30}(?:\.\d{1,18})?)\b/u);
    const amount = percentMatch ? parseAmount(`${percentMatch[1]}%`) : parseAmount(amountMatch?.[1]);
    const intent: TradeIntent = {
      action: "SELL",
      source,
      chainId,
      ...(explicitAddress ? { tokenAddress: explicitAddress } : {}),
      ...(effectiveSymbol ? { tokenSymbol: effectiveSymbol } : {}),
      ...(amount ? { amount: amount.amount, amountType: amount.amountType } : {}),
    };
    const needs: TradeClarification["reason"][] = [];
    if (!explicitAddress && !symbolIsUnambiguous) needs.push("MISSING_TOKEN");
    if (!amount) needs.push("MISSING_AMOUNT");
    return { status: "intent", intent, needs };
  }

  // A bare Clank.trade link is a navigation request, not a trade.
  if (url) {
    return { status: "intent", intent: { action: "OPEN_TOKEN", chainId, source }, needs: ["MISSING_TOKEN"] };
  }

  return { status: "none" };
}

/** Human question for a missing or ambiguous piece of a trade request. */
export function clarificationFor(need: TradeClarification["reason"], intent: TradeIntent): TradeClarification {
  const symbol = intent.tokenSymbol ? `$${intent.tokenSymbol}` : "that coin";
  switch (need) {
    case "MISSING_TOKEN":
      return { reason: "MISSING_TOKEN", question: "Which coin do you mean? Show me the Clank.trade page or paste the contract address." };
    case "MISSING_AMOUNT":
      return {
        reason: "MISSING_AMOUNT",
        question: intent.action === "SELL" ? `How much of ${symbol} should I prepare to sell?` : `How much should I prepare to spend on ${symbol}?`,
      };
    case "AMBIGUOUS_TOKEN":
      return { reason: "AMBIGUOUS_TOKEN", question: `More than one token uses ${symbol}. Which contract address do you mean?` };
    case "AMBIGUOUS_AMOUNT":
      return { reason: "AMBIGUOUS_AMOUNT", question: "How much, and in what - an amount of the token, or a percentage of your balance?" };
    case "UNSUPPORTED_ACTION":
    default:
      return { reason: "UNSUPPORTED_ACTION", question: "I can't prepare that one yet. I can help with buys, sells, contract details, and opening a coin on Clank.trade." };
  }
}

export const tradeActionLabels: Record<TradeAction, string> = {
  BUY: "Buy",
  SELL: "Sell",
  OPEN_TOKEN: "Open on Clank.trade",
  COPY_CONTRACT: "Show contract",
  SWITCH_NETWORK: "Switch network",
  SHOW_TOKEN: "Show token",
};

export { nativeSymbols };