import { shortAddress } from "@/lib/wallet-data/types";
import type { WalletSnapshot } from "@/lib/wallet-data/types";
import type { TokenMetadata } from "@/lib/tokens/metadata";
import type { ActionCard, ActionCardLink, ActionCardRow, ImageCard, TradeCard } from "@/lib/actions/types";
import type { ImagePipelineDebugDetails } from "@/lib/image-generation/pipeline-trace";
import type { TradeIntent, TradeSummaryRow } from "@/lib/trading/types";

/**
 * Card builders.
 *
 * These live apart from the runtime so the exact shape Cabi shows is unit
 * testable. Two rules are enforced here rather than trusted to callers:
 *
 * 1. Every link is an exact absolute HTTPS URL that was already validated
 *    upstream. No card builds a URL by concatenation from user input.
 * 2. No row is ever added for data we do not have. There is no price, market
 *    cap, holder count, or bonding percentage field in the model at all.
 */

let cardCounter = 0;
function nextId(prefix: string) {
  cardCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${cardCounter.toString(36)}`;
}

/** Only absolute HTTPS links may be rendered as card actions. */
export function safeLinks(links: Array<ActionCardLink | null | undefined>): ActionCardLink[] {
  return links.filter((link): link is ActionCardLink => {
    if (!link) return false;
    try {
      return new URL(link.url).protocol === "https:";
    } catch {
      return false;
    }
  });
}

export function tokenCard(token: TokenMetadata): ActionCard {
  const rows: ActionCardRow[] = [
    { label: "Contract", value: token.address, mono: true },
  ];
  if (token.chainName) rows.push({ label: "Network", value: token.chainName });
  if (token.origin === "CONFIGURED") rows.push({ label: "Source", value: "Owner-published" });
  if (token.unavailableReason) rows.push({ label: "Metadata", value: "Unavailable", muted: true });

  const links = safeLinks([
    token.clankTradeUrl ? { label: `Open ${token.symbol || "token"} on Clank.trade`, url: token.clankTradeUrl, kind: "CLANK_TRADE" as const } : null,
    token.explorerUrl ? { label: "View on explorer", url: token.explorerUrl, kind: "EXPLORER" as const } : null,
  ]);

  return {
    kind: "TOKEN",
    id: nextId("token"),
    tokenAddress: token.address,
    title: token.name || token.symbol || "Token",
    subtitle: token.symbol ? `$${token.symbol}` : undefined,
    rows,
    links,
    tone: token.origin === "UNRESOLVED" ? "caution" : "neutral",
    message: token.unavailableReason,
  };
}

export function holdingCard(snapshot: WalletSnapshot, index: number): ActionCard | null {
  const token = snapshot.tokens[index];
  if (!token) return null;
  const rows: ActionCardRow[] = [
    { label: "Balance", value: `${token.formatted} ${token.symbol}` },
    { label: "Contract", value: shortAddress(token.address, 8, 6), mono: true },
    { label: "Network", value: snapshot.chainName },
  ];
  return {
    kind: "HOLDING",
    id: nextId("holding"),
    tokenAddress: token.address,
    title: token.name || token.symbol,
    subtitle: `$${token.symbol}`,
    rows,
    links: safeLinks([
      token.verifiedUrl ? { label: `Open $${token.symbol} on Clank.trade`, url: token.verifiedUrl, kind: "CLANK_TRADE" as const } : null,
      snapshot.explorerUrl ? { label: "View wallet on explorer", url: snapshot.explorerUrl, kind: "EXPLORER" as const } : null,
    ]),
  };
}

export function walletCard(snapshot: WalletSnapshot, options: { networkNote?: string | null } = {}): ActionCard {
  const rows: ActionCardRow[] = [
    { label: "Wallet", value: snapshot.address, mono: true },
    { label: "Network", value: snapshot.chainName },
  ];
  if (snapshot.native) rows.push({ label: "Balance", value: `${snapshot.native.formatted} ${snapshot.native.symbol}` });
  if (snapshot.tokens.length > 0) rows.push({ label: "Tokens tracked", value: String(snapshot.tokens.length) });
  if (options.networkNote) rows.push({ label: "Note", value: options.networkNote, muted: true });

  return {
    kind: "WALLET",
    id: nextId("wallet"),
    title: "Your wallet",
    subtitle: shortAddress(snapshot.address),
    rows,
    links: safeLinks([
      snapshot.explorerUrl ? { label: "View on explorer", url: snapshot.explorerUrl, kind: "EXPLORER" as const } : null,
    ]),
  };
}

export function portfolioCard(snapshot: WalletSnapshot): ActionCard {
  const rows: ActionCardRow[] = [
    { label: "Wallet", value: shortAddress(snapshot.address), mono: true },
    { label: "Network", value: snapshot.chainName },
  ];
  if (snapshot.native) rows.push({ label: snapshot.native.symbol, value: snapshot.native.formatted });
  for (const token of snapshot.tokens) {
    rows.push({ label: token.symbol, value: token.formatted, mono: false });
  }
  if (snapshot.tokens.length === 0) {
    rows.push({ label: "Tokens", value: "Nothing tracked on this network", muted: true });
  }

  return {
    kind: "PORTFOLIO",
    id: nextId("portfolio"),
    title: "Your holdings",
    subtitle: shortAddress(snapshot.address),
    rows,
    links: safeLinks([
      snapshot.explorerUrl ? { label: "View on explorer", url: snapshot.explorerUrl, kind: "EXPLORER" as const } : null,
      { label: "Open portfolio", url: "/portfolio", kind: "INTERNAL" as const },
    ]),
  };
}

/**
 * The trade card.
 *
 * `directExecution` is threaded through from the provider rather than assumed.
 * While no verified Clank.trade execution interface exists the card offers only
 * the exact verified coin page, and says so.
 */
export function tradeCard(input: {
  action: "BUY" | "SELL";
  intent: TradeIntent;
  token?: { address: string; symbol: string; name: string } | null;
  chainName?: string | null;
  summary?: TradeSummaryRow[];
  route?: string;
  state: string;
  directExecution: boolean;
  clankTradeUrl?: string | null;
  explorerUrl?: string | null;
}): TradeCard {
  const rows: ActionCardRow[] = [];
  if (input.token) {
    rows.push({ label: "Token", value: input.token.name || `$${input.token.symbol}` });
    rows.push({ label: "Contract", value: input.token.address, mono: true });
  } else if (input.intent.tokenSymbol) {
    rows.push({ label: "Token", value: `$${input.intent.tokenSymbol}` });
  }
  if (input.intent.amount && input.intent.amountType) {
    rows.push({
      label: input.action === "SELL" ? "Sell" : "Spend",
      value: input.intent.amountType === "PERCENTAGE"
        ? `${input.intent.amount}% of your balance`
        : `${input.intent.amount}${input.intent.amountType === "NATIVE" ? " (native)" : ""}`,
    });
  }
  if (input.chainName) rows.push({ label: "Network", value: input.chainName });
  if (input.route) rows.push({ label: "Route", value: input.route });
  for (const row of input.summary ?? []) {
    if (!rows.some((existing) => existing.label === row.label)) rows.push(row);
  }

  const links = safeLinks([
    input.clankTradeUrl ? { label: "Open on Clank.trade", url: input.clankTradeUrl, kind: "CLANK_TRADE" as const } : null,
    input.explorerUrl ? { label: "View contract", url: input.explorerUrl, kind: "EXPLORER" as const } : null,
  ]);

  return {
    kind: "TRADE",
    id: nextId("trade"),
    action: input.action,
    state: input.state,
    title: `${input.action} ${input.token?.symbol ? `$${input.token.symbol}` : input.intent.tokenSymbol ? `$${input.intent.tokenSymbol}` : "token"}`,
    subtitle: input.directExecution ? "Review, then confirm in your wallet" : "Prepare only - you confirm on Clank.trade",
    rows,
    links,
    requiresConfirmation: true,
    tokenAddress: input.token?.address,
    tokenSymbol: input.token?.symbol ?? input.intent.tokenSymbol,
    tokenName: input.token?.name,
    chainName: input.chainName ?? null,
    route: input.route,
    directExecution: input.directExecution,
    tone: input.directExecution ? "neutral" : "caution",
  };
}

export function clarifyCard(input: { question: string; options?: Array<{ id: string; label: string; detail?: string; address?: string }> }): ActionCard {
  return {
    kind: "CLARIFY",
    id: nextId("clarify"),
    title: "Which one?",
    subtitle: input.question,
    rows: [],
    links: [],
    options: input.options,
    tone: "caution",
  };
}

export function noticeCard(input: { title: string; message: string; tone?: "neutral" | "caution" | "error"; rows?: ActionCardRow[]; links?: Array<ActionCardLink | null>; retry?: { label: string; prompt: string; parentGenerationId?: string }; debugDetails?: ImagePipelineDebugDetails }): ActionCard {
  return {
    kind: "NOTICE",
    id: nextId("notice"),
    title: input.title,
    rows: [],
    links: safeLinks(input.links ?? []),
    tone: input.tone ?? "neutral",
    message: input.message,
    retry: input.retry,
    debugDetails: input.debugDetails,
  };
}
/**
 * A generated Cabi image.
 *
 * The card carries a signed URL that expires, so a shared screenshot or copied
 * link cannot be used to reach someone else's private generation later.
 */
export function imageCard(input: {
  generationId: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  canUseAsAvatar: boolean;
  xp?: number | null;
  initials?: string | null;
}): ImageCard {
  return {
    kind: "IMAGE",
    id: nextId("image"),
    title: "Cabi",
    subtitle: "Generated just now",
    tone: "neutral",
    // The image is the content; rows stay empty so the card does not compete
    // with it for attention.
    rows: [],
    links: [],
    requiresConfirmation: false,
    generationId: input.generationId,
    // Only an absolute HTTPS URL is accepted; anything else becomes empty rather
    // than reaching an <img src>.
    url: /^https:\/\//iu.test(input.url) ? input.url : "",
    prompt: input.prompt.slice(0, 400),
    aspectRatio: input.aspectRatio,
    createdAt: input.createdAt,
    canUseAsAvatar: Boolean(input.canUseAsAvatar && input.initials),
    xp: typeof input.xp === "number" && input.xp > 0 ? input.xp : null,
  };
}
