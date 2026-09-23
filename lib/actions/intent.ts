import { extractTradeIntent, type IntentExtraction } from "@/lib/trading/intent";
import { parseSlashCommand, type ParsedSlashCommand } from "@/lib/actions/slash-commands";
import { normalizeTradeAddress, parseClankTradeUrl, type TradeIntent } from "@/lib/trading/types";

/**
 * The single interpretation step between a raw user message and a typed action.
 *
 * Order matters and is deliberate:
 *
 * 1. A slash command wins - the user was explicit.
 * 2. A pasted Clank.trade URL or contract address is treated as a token
 *    reference, because that is what it is.
 * 3. Trade phrases are extracted deterministically by `extractTradeIntent`.
 * 4. Wallet-introspection phrases are matched next.
 * 5. Anything else falls through to the model, untouched.
 *
 * Steps 1-4 never call a model, so wallet reads and token lookups cost nothing
 * and cannot be influenced by generated text.
 */

export type ActionRequest =
  | { type: "SLASH"; command: ParsedSlashCommand & { matched: true } }
  | { type: "TRADE"; intent: TradeIntent; needs: string[] }
  | { type: "CLARIFY"; question: string; reason: string }
  | { type: "WALLET_INFO" }
  | { type: "PORTFOLIO" }
  | { type: "HOLDING"; symbol?: string; address?: string }
  | { type: "TOKEN_LOOKUP"; address?: string; symbol?: string }
  | { type: "MEMORY_LIST" }
  | { type: "MEMORY_REMEMBER"; content: string }
  | { type: "MEMORY_FORGET"; content: string }
  | { type: "BOND" }
  | { type: "HELP" }
  | { type: "NONE" };

export type ActionContext = {
  selectedToken?: { address: string; symbol: string; chainId: number; verifiedUrl?: string };
  chainId?: number | null;
  /** Owner-configured ticker, so "cpu" resolves to the published token. */
  cpuSymbol?: string | null;
};

const addressInMessage = /0x[0-9a-fA-F]{40}/u;
const clankUrlInMessage = /https:\/\/[^\s)>\]]*clank\.trade[^\s)>\]]*/u;

/** Any URL the user pasted, so we can refuse non-Clank destinations explicitly. */
const anyUrlInMessage = /https?:\/\/[^\s)>\]]+/u;

export function interpretMessage(message: string, context: ActionContext = {}): ActionRequest {
  const text = message.trim();
  if (!text) return { type: "NONE" };

  // 1. Slash commands.
  const slash = parseSlashCommand(text);
  if (slash.matched) return { type: "SLASH", command: slash };

  const lower = text.toLowerCase();

  // 2. A pasted link. Only Clank.trade is accepted; anything else is refused
  //    rather than fetched, which removes the SSRF surface entirely.
  const pastedUrl = text.match(anyUrlInMessage)?.[0];
  if (pastedUrl && !clankUrlInMessage.test(text)) {
    return {
      type: "CLARIFY",
      reason: "UNSUPPORTED_URL",
      question: "I only open Clank.trade links. Paste the Clank.trade page or the contract address and I'll take it from there.",
    };
  }
  const clankUrl = text.match(clankUrlInMessage)?.[0];
  if (clankUrl) {
    const verified = parseClankTradeUrl(clankUrl);
    if (!verified) {
      return { type: "CLARIFY", reason: "UNSUPPORTED_URL", question: "That Clank.trade link didn't look right. Can you paste it again?" };
    }
    // A bare link opens the coin; a link inside a request is a token reference.
    if (lower.replace(clankUrl.toLowerCase(), "").trim().length < 3) {
      return { type: "TOKEN_LOOKUP", address: addressInMessage.test(text) ? text.match(addressInMessage)![0] : undefined };
    }
    return { type: "TOKEN_LOOKUP", address: addressInMessage.test(text) ? text.match(addressInMessage)![0] : undefined };
  }

  // 3. Trade phrases.
  const trade: IntentExtraction = extractTradeIntent(text, context);
  if (trade.status === "unsupported") return { type: "CLARIFY", reason: "UNSAFE_REQUEST", question: trade.reason };
  if (trade.status === "clarify") return { type: "CLARIFY", reason: trade.clarification.reason, question: trade.clarification.question };
  if (trade.status === "intent") return { type: "TRADE", intent: trade.intent, needs: trade.needs };

  // 4. A bare pasted address is a token lookup.
  const bareAddress = text.match(addressInMessage)?.[0];
  if (bareAddress) {
    try {
      normalizeTradeAddress(bareAddress);
      return { type: "TOKEN_LOOKUP", address: bareAddress };
    } catch {
      return { type: "CLARIFY", reason: "INVALID_ADDRESS", question: "That doesn't look like a valid contract address." };
    }
  }

  // 5. Memory commands, checked before wallet questions because "remember" is explicit.
  const remember = text.match(/^\s*(?:please\s+)?remember(?:\s+that)?\s+(.{3,400})$/iu);
  if (remember) return { type: "MEMORY_REMEMBER", content: remember[1].trim() };
  const forget = text.match(/^\s*(?:please\s+)?forget(?:\s+(?:that|about))?\s+(.{3,400})$/iu);
  if (forget) return { type: "MEMORY_FORGET", content: forget[1].trim() };
  if (/\bwhat do you (remember|know) about me\b/iu.test(text) || /\bshow (me )?(my )?memor(y|ies)\b/iu.test(text)) {
    return { type: "MEMORY_LIST" };
  }

  // 6. Wallet introspection. Kept narrow so ordinary conversation is unaffected.
  if (/\b(what|which)\b[^?]*\bwallet\b/iu.test(text) || /\bmy wallet\b/iu.test(text) || /\bshow (me )?my wallet\b/iu.test(text)) {
    return { type: "WALLET_INFO" };
  }
  if (/\bwhat (network|chain) am i\b/iu.test(text) || /\bwhich (network|chain)\b[^?]*\b(i|am i)\b/iu.test(text)) {
    return { type: "WALLET_INFO" };
  }
  if (/\b(portfolio|holdings|what do i (own|hold)|show (me )?(my )?(tokens|holdings|portfolio))\b/iu.test(text)) {
    return { type: "PORTFOLIO" };
  }
  if (/\bhow much\b[^?]*\b(eth|bnb|matic|pol|native)\b/iu.test(text) || /\bmy balance\b/iu.test(text)) {
    return { type: "WALLET_INFO" };
  }

  // 7. A question about one specific holding.
  const holdingQuestion = text.match(/\b(?:do i (?:own|have|hold)|how much)\b[^?]*\$?([A-Za-z][A-Za-z0-9]{1,15})\b/iu);
  if (holdingQuestion) {
    const symbol = holdingQuestion[1].toUpperCase();
    // "how much eth do i have" is a native-balance question, not a token one.
    if (["ETH", "BNB", "MATIC", "POL", "AVAX", "NATIVE"].includes(symbol)) return { type: "WALLET_INFO" };
    return { type: "HOLDING", symbol };
  }

  // 8. Explicit token-info phrasing.
  if (/\b(tell me about|what is|show me|info on|look up)\b[^?]*\$([A-Za-z][A-Za-z0-9]{1,15})\b/iu.test(text)) {
    const symbol = text.match(/\$([A-Za-z][A-Za-z0-9]{1,15})\b/u)?.[1];
    return { type: "TOKEN_LOOKUP", symbol: symbol?.toUpperCase() };
  }

  if (/\b(what can you do|how do i use you|help me get started|^help$)\b/iu.test(text)) return { type: "HELP" };

  return { type: "NONE" };
}