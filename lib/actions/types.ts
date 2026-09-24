/**
 * The action layer's card model.
 *
 * Everything Cabi can show inline in a conversation resolves to one of these
 * cards. They are plain serialisable data so they can travel over the SSE
 * stream, be stored on the message row, and re-render identically after a
 * reload.
 *
 * A card NEVER carries executable transaction data. The trade card carries the
 * summary display fields and, at most, an exact verified Clank.trade link. Any
 * future direct-execution path must still go through `TradeState` and an
 * explicit user confirmation.
 */

export type ActionCardKind = "TRADE" | "TOKEN" | "WALLET" | "PORTFOLIO" | "HOLDING" | "CLARIFY" | "NOTICE" | "IMAGE";

export type ActionCardRow = { label: string; value: string; mono?: boolean; muted?: boolean };

/** Links a card may offer. `url` is always an exact verified destination. */
export type ActionCardLink = {
  label: string;
  url: string;
  kind: "CLANK_TRADE" | "EXPLORER" | "INTERNAL";
};

export type BaseCard = {
  kind: ActionCardKind;
  id: string;
  title: string;
  subtitle?: string;
  rows: ActionCardRow[];
  links: ActionCardLink[];
  /** Present when the user must choose between options before anything happens. */
  options?: Array<{ id: string; label: string; detail?: string; address?: string }>;
  /** True when this card needs an explicit confirmation before any next step. */
  requiresConfirmation?: boolean;
  /** Set when the request could not be completed, so the UI can style it. */
  tone?: "neutral" | "caution" | "error";
  /** Short reason shown for non-actionable cards. */
  message?: string;
  /** A safe, user-initiated retry for transient generation failures. */
  retry?: {
    label: string;
    prompt: string;
    parentGenerationId?: string;
  };
};

export type TradeCard = BaseCard & {
  kind: "TRADE";
  action: "BUY" | "SELL";
  state: string;
  /** Contract address, when resolved. Safe to display. */
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  chainName?: string | null;
  route?: string;
  /** Only ever true when a documented execution interface is configured. */
  directExecution: boolean;
};

export type TokenCard = BaseCard & { kind: "TOKEN"; tokenAddress: string };
export type WalletCard = BaseCard & { kind: "WALLET" };
export type PortfolioCard = BaseCard & { kind: "PORTFOLIO" };
export type HoldingCard = BaseCard & { kind: "HOLDING"; tokenAddress: string };
export type ClarifyCard = BaseCard & { kind: "CLARIFY" };
export type NoticeCard = BaseCard & { kind: "NOTICE" };

/**
 * A generated Cabi image.
 *
 * `prompt` is the user's own words, never the internal character specification.
 * `url` is a short-lived signed storage link, so a card that is copied out of
 * context stops working rather than exposing a private generation.
 */
export type ImageCard = BaseCard & {
  kind: "IMAGE";
  generationId: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  /** Only true once the user has claimed a username to attach it to. */
  canUseAsAvatar: boolean;
  xp: number | null;
};

export type ActionCard = TradeCard | TokenCard | WalletCard | PortfolioCard | HoldingCard | ClarifyCard | NoticeCard | ImageCard;

/** Everything the action runtime can decide to do with one user message. */
export type ActionOutcome = {
  /** The card to render, when the message produced one. */
  card: ActionCard | null;
  /** How Cabi should acknowledge the request in prose. */
  reply: string | null;
  /**
   * Whether the model should still be called. Deterministic actions (wallet
   * reads, slash commands, token lookups) answer without an LLM round trip so a
   * wallet balance never costs a token or a second of latency.
   */
  skipModel: boolean;
  /** Extra context to hand the model when it does run. */
  modelHint?: string;
};
