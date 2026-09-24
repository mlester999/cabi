import "server-only";

import { clarifyCard, holdingCard, noticeCard, portfolioCard, tokenCard, tradeCard, walletCard } from "@/lib/actions/cards";
import { interpretMessage, type ActionContext, type ActionRequest } from "@/lib/actions/intent";
import { slashCommands } from "@/lib/actions/slash-commands";
import type { ActionOutcome } from "@/lib/actions/types";
import { createClankTradeProvider } from "@/lib/trading/clankTrade";
import { tradeActionLabels } from "@/lib/trading/intent";
import type { TradeIntent } from "@/lib/trading/types";
import { resolveConfiguredCpu, resolveTokenMetadata } from "@/lib/tokens/metadata";
import { readWalletSnapshot } from "@/lib/wallet-data/client";
import { shortAddress, type WalletSnapshot } from "@/lib/wallet-data/types";
import { getPublicWalletConfig, type PublicWalletConfig } from "@/lib/wallet/config";
import { defaultFeatureFlags, type FeatureFlags } from "@/lib/config/feature-flags";

/**
 * The action runtime.
 *
 * This is the trusted half of the action layer: it receives a typed request and
 * the caller's *verified* session context, and produces a card plus the prose
 * Cabi should use. It never receives, and never invents, executable transaction
 * data - the only thing a trade card can offer is a validated external link or a
 * prepared request that still requires the user's explicit confirmation.
 *
 * Wallet reads only happen for requests that need them, and only for the address
 * the caller passed in (which comes from the signed session cookie upstream).
 */

export type ActionRunContext = ActionContext & {
  /** From the verified wallet session. Never from a request body. */
  walletAddress?: string | null;
  walletChainId?: number | null;
  /** True when memory is enabled for this user. */
  memoryEnabled?: boolean;
  /**
   * Injected when the caller has already loaded it (the chat route has, as part
   * of its own parallel reads). Passing it avoids a redundant database read on a
   * path that must stay database-free for guests.
   */
  config?: PublicWalletConfig;
  snapshot?: WalletSnapshot | null;
  /** Resolved on the server. Future wallet surfaces fail closed when omitted. */
  featureFlags?: FeatureFlags;
};

export type ActionRunResult = ActionOutcome & {
  /** Compact factual notes the model may use. No private data, no secrets. */
  contextNotes: string[];
  /** Set when a wallet read was attempted but failed, for error UX. */
  walletError?: string;
};

function providerFor(config: PublicWalletConfig) {
  return createClankTradeProvider({
    configuredCpu: config.cpu.contractAddress
      ? {
        address: config.cpu.contractAddress,
        url: config.cpu.clankTradeUrl,
        symbol: config.cpu.ticker,
        name: config.cpu.tokenName,
      }
      : null,
  });
}

async function loadSnapshot(context: ActionRunContext, config: PublicWalletConfig) {
  if (context.snapshot) return { snapshot: context.snapshot, error: undefined as string | undefined };
  if (!context.walletAddress) return { snapshot: null, error: undefined };
  const result = await readWalletSnapshot({
    address: context.walletAddress,
    chainId: context.walletChainId ?? null,
    config,
  });
  if (!result.ok) return { snapshot: null, error: result.message };
  return { snapshot: result.data, error: undefined };
}

function walletRequired(): ActionRunResult {
  return {
    card: noticeCard({
      title: "Connect your wallet first",
      message: "Connect and sign in with an EVM wallet and I can read your public onchain balance and holdings.",
      links: [{ label: "Open settings", url: "/settings", kind: "INTERNAL" }],
    }),
    reply: "Connect your wallet first and I can check.",
    skipModel: true,
    contextNotes: [],
  };
}

function lockedFeatureNotice(title: string, message: string): ActionRunResult {
  return {
    card: noticeCard({ title, message }),
    reply: message,
    skipModel: true,
    contextNotes: [],
  };
}

/** Native balance card rows are built from the snapshot, never from a guess. */
function balanceAnswer(snapshot: WalletSnapshot): string {
  if (!snapshot.native) return `I couldn't read your ${snapshot.nativeCurrency.symbol} balance on ${snapshot.chainName}.`;
  return `You're on ${snapshot.chainName} with ${snapshot.native.formatted} ${snapshot.native.symbol}.`;
}

async function runTokenLookup(request: Extract<ActionRequest, { type: "TOKEN_LOOKUP" }>, context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  // A bare ticker is not an identity. Only the owner-published token, or a
  // symbol the user actually holds, may be resolved without an address.
  if (!request.address) {
    const symbol = (request.symbol ?? "").toUpperCase();
    const cpuSymbol = (config.cpu.ticker || "CPU").toUpperCase();
    if (symbol === cpuSymbol) {
      const cpuToken = await resolveConfiguredCpu(config);
      if (!cpuToken) {
        return {
          card: noticeCard({
            title: "No $CPU published yet",
            message: "The owner hasn't published the $CPU contract yet, so there's nothing verified for me to show.",
          }),
          reply: "I don't have a verified $CPU contract to show yet.",
          skipModel: true,
          contextNotes: [],
        };
      }
      return { card: tokenCard(cpuToken), reply: `Here's $${cpuToken.symbol}.`, skipModel: true, contextNotes: [`The user asked about the project token ${cpuToken.symbol} at ${cpuToken.address}.`] };
    }

    const { snapshot } = await loadSnapshot(context, config);
    const held = snapshot?.tokens.find((token) => token.symbol.toUpperCase() === symbol);
    if (held) {
      const metadata = await resolveTokenMetadata(held.address, { config });
      if (metadata) {
        return {
          card: tokenCard(metadata),
          reply: `That's the one you hold: ${held.formatted} $${held.symbol}.`,
          skipModel: true,
          contextNotes: [`The user holds ${held.formatted} ${held.symbol} at ${held.address}.`],
        };
      }
    }
    return {
      card: clarifyCard({
        question: `I can't safely match $${symbol || "that"} to one contract. Which address do you mean?`,
      }),
      reply: `More than one token can use that ticker, so I need the contract address for $${symbol || "it"}.`,
      skipModel: true,
      contextNotes: [],
    };
  }

  const metadata = await resolveTokenMetadata(request.address, { config });
  if (!metadata) {
    return {
      card: noticeCard({
        title: "I couldn't verify that token",
        message: "That doesn't look like a valid EVM contract address.",
        tone: "error",
      }),
      reply: "I couldn't verify that token.",
      skipModel: true,
      contextNotes: [],
    };
  }
  return {
    card: tokenCard(metadata),
    reply: metadata.origin === "UNRESOLVED"
      ? "Here's the contract. I couldn't read its metadata from the network."
      : `Here's ${metadata.name}${metadata.symbol ? ` ($${metadata.symbol})` : ""}.`,
    skipModel: true,
    contextNotes: [`The user asked about token ${metadata.symbol || "unknown"} at ${metadata.address} on ${metadata.chainName ?? "an unconfigured network"}.`],
  };
}

async function runHolding(request: Extract<ActionRequest, { type: "HOLDING" }>, context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  if (!context.walletAddress) return walletRequired();
  const { snapshot, error } = await loadSnapshot(context, config);
  if (error || !snapshot) {
    return {
      card: noticeCard({ title: "I couldn't read your wallet", message: error ?? "I couldn't read your wallet right now.", tone: "error" }),
      reply: "I couldn't read your wallet right now.",
      skipModel: true,
      contextNotes: [],
    };
  }
  const symbol = (request.symbol ?? "").toUpperCase();
  const index = snapshot.tokens.findIndex((token) => token.symbol.toUpperCase() === symbol);
  if (index < 0) {
    return {
      card: walletCard(snapshot),
      reply: `I don't see $${symbol} in the tokens I track for ${shortAddress(snapshot.address)}. I only track tokens the owner has configured.`,
      skipModel: true,
      contextNotes: [`The user holds no tracked ${symbol} on ${snapshot.chainName}.`],
    };
  }
  const token = snapshot.tokens[index];
  return {
    card: holdingCard(snapshot, index) ?? walletCard(snapshot),
    reply: `You hold ${token.formatted} $${token.symbol}.`,
    skipModel: true,
    contextNotes: [`The user holds ${token.formatted} ${token.symbol} on ${snapshot.chainName}.`],
  };
}

async function runTrade(intent: TradeIntent, context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  const flags = context.featureFlags ?? defaultFeatureFlags;
  if ((intent.action === "BUY" || intent.action === "SELL") && !flags.direct_trading_enabled) {
    return lockedFeatureNotice("Automated trading is in the works", "Cabi cannot prepare trades yet. I can still help you inspect a verified token page.");
  }
  const provider = providerFor(config);
  const enabledChains = config.chains.filter((chain) => chain.enabled);
  const chain = enabledChains.find((item) => item.id === (intent.chainId ?? context.chainId)) ?? enabledChains[0] ?? null;

  if (intent.action === "SWITCH_NETWORK") {
    if (!chain) {
      return {
        card: noticeCard({ title: "No network configured", message: "No EVM network is configured for Cabi yet.", tone: "caution" }),
        reply: "I don't have a network configured to switch you to yet.",
        skipModel: true,
        contextNotes: [],
      };
    }
    const needsSwitch = context.walletChainId != null && context.walletChainId !== chain.id;
    return {
      card: {
        kind: "NOTICE",
        id: `switch-${chain.id}`,
        title: needsSwitch ? `Switch to ${chain.name}` : `You're already on ${chain.name}`,
        rows: [{ label: "Network", value: chain.name }, { label: "Chain ID", value: String(chain.id) }],
        links: [],
        tone: needsSwitch ? "caution" : "neutral",
        message: needsSwitch
          ? "Use the network switcher in your wallet menu to move to this chain."
          : "Nothing to do.",
      },
      reply: needsSwitch ? `You're on a different network. Switch to ${chain.name} and I'll be ready.` : `You're already on ${chain.name}.`,
      skipModel: true,
      contextNotes: [],
    };
  }

  if (intent.action === "COPY_CONTRACT" || intent.action === "SHOW_TOKEN") {
    const metadata = intent.tokenAddress ? await resolveTokenMetadata(intent.tokenAddress, { config }) : null;
    if (!metadata) {
      return {
        card: clarifyCard({ question: "Which coin's contract should I show you?" }),
        reply: "Which coin do you mean? Show me the Clank.trade page or paste the contract address.",
        skipModel: true,
        contextNotes: [],
      };
    }
    return { card: tokenCard(metadata), reply: `Here's the contract for ${metadata.symbol || metadata.name}.`, skipModel: true, contextNotes: [] };
  }

  if (intent.action === "OPEN_TOKEN") {
    const metadata = intent.tokenAddress ? await resolveTokenMetadata(intent.tokenAddress, { config }) : null;
    const url = metadata?.clankTradeUrl ?? (intent.tokenAddress ? provider.tokenPageUrl({ address: intent.tokenAddress, verifiedUrl: undefined }) : null);
    if (!metadata || !url) {
      return {
        card: noticeCard({
          title: "No verified page for that coin",
          message: "I only open exact Clank.trade coin pages the owner has verified. Paste the coin's Clank.trade link and I'll use it.",
          tone: "caution",
        }),
        reply: "I couldn't open that coin right now.",
        skipModel: true,
        contextNotes: [],
      };
    }
    return {
      card: { ...tokenCard(metadata), title: `Open ${metadata.symbol || metadata.name}` },
      reply: "Here it is. Opening this takes you to the official coin page.",
      skipModel: true,
      contextNotes: [],
    };
  }

  // BUY / SELL
  const candidates = await provider.resolveToken({ address: intent.tokenAddress, symbol: intent.tokenSymbol, chainId: chain?.id ?? null });

  if (candidates.length === 0) {
    const question = intent.tokenSymbol
      ? `I can't safely match $${intent.tokenSymbol} to one contract. Which address do you mean?`
      : "Which coin do you mean? Paste the contract address or its Clank.trade page.";
    return {
      card: clarifyCard({ question }),
      reply: question,
      skipModel: true,
      contextNotes: [],
    };
  }

  const token = candidates[0];
  const metadata = await resolveTokenMetadata(token.address, { config });
  const clankTradeUrl = metadata?.clankTradeUrl ?? provider.tokenPageUrl(token) ?? null;

  // A request with a missing amount is prepared but not actionable.
  if (!intent.amount || !intent.amountType) {
    return {
      card: tradeCard({
        action: intent.action === "SELL" ? "SELL" : "BUY",
        intent,
        token: metadata ? { address: metadata.address, symbol: metadata.symbol, name: metadata.name } : { address: token.address, symbol: token.symbol, name: token.name },
        chainName: chain?.name ?? null,
        route: provider.label,
        state: "NEEDS_CLARIFICATION",
        directExecution: provider.supportsDirectTransactions,
        clankTradeUrl,
        explorerUrl: metadata?.explorerUrl ?? null,
      }),
      reply: intent.action === "SELL"
        ? `How much of $${token.symbol || "it"} should I prepare to sell?`
        : `How much should I prepare to spend on $${token.symbol || "it"}?`,
      skipModel: true,
      contextNotes: [],
    };
  }

  const card = tradeCard({
    action: intent.action === "SELL" ? "SELL" : "BUY",
    intent,
    token: metadata ? { address: metadata.address, symbol: metadata.symbol, name: metadata.name } : { address: token.address, symbol: token.symbol, name: token.name },
    chainName: chain?.name ?? null,
    route: provider.label,
    state: "AWAITING_USER_CONFIRMATION",
    directExecution: provider.supportsDirectTransactions,
    clankTradeUrl,
    explorerUrl: metadata?.explorerUrl ?? null,
  });

  return {
    card,
    reply: provider.supportsDirectTransactions
      ? "Here's what I'd send. Review it, then confirm in your wallet."
      : `Here's what you asked for: ${tradeActionLabels[intent.action].toLowerCase()} ${intent.amount}${intent.amountType === "NATIVE" ? ` ${chain?.nativeCurrency.symbol ?? ""}` : ""} of $${token.symbol || "that token"}. Nothing moves until you open it on Clank.trade and confirm there.`,
    // The card carries the meaning; the model still writes the surrounding
    // sentence so Cabi sounds like herself.
    skipModel: false,
    modelHint: `The user asked you to prepare a ${intent.action} for $${token.symbol || "a token"}. An action card is already shown to them with the contract and network. Do not restate the card's fields as a list, do not claim you executed anything, and do not invent a price, quote, gas estimate, or expected receive amount. Two short sentences at most.`,
    contextNotes: [],
  };
}

function helpOutcome(): ActionRunResult {
  return {
    card: {
      kind: "NOTICE",
      id: "help",
      title: "What I can do",
      rows: slashCommands.map((command) => ({ label: command.id, value: command.description })),
      links: [],
      tone: "neutral",
    },
    reply: "Here's what I've got.",
    skipModel: true,
    contextNotes: [],
  };
}

/** Runs a slash command. Navigation-only commands return no card. */
async function runSlash(command: { id: string }, rest: string, context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  switch (command.id) {
    case "/cpu": return runTokenLookup({ type: "TOKEN_LOOKUP", symbol: config.cpu.ticker || "CPU" }, context, config);
    case "/wallet": return runWalletInfo(context, config);
    case "/bond":
      return { card: null, reply: "Opening your bond with me.", skipModel: true, contextNotes: [] };
    case "/memory":
      return { card: null, reply: "Opening your memories.", skipModel: true, contextNotes: [] };
    case "/settings":
      return { card: null, reply: "Opening settings.", skipModel: true, contextNotes: [] };
    case "/new":
      return { card: null, reply: null, skipModel: true, contextNotes: [] };
    case "/help":
    default:
      if (rest) return helpOutcome();
      return helpOutcome();
  }
}

async function runWalletInfo(context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  if (!context.walletAddress) return walletRequired();
  const { snapshot, error } = await loadSnapshot(context, config);
  if (error || !snapshot) {
    return {
      card: noticeCard({ title: "I couldn't read your wallet", message: error ?? "I couldn't read your wallet right now.", tone: "error" }),
      reply: "I couldn't read your wallet right now.",
      skipModel: true,
      contextNotes: [],
    };
  }
  const enabled = snapshot.supportedChains.filter((chain) => chain.enabled);
  const networkNote = context.walletChainId != null && context.walletChainId !== snapshot.chainId
    ? `Your wallet is on chain ${context.walletChainId}, but I read balances on ${snapshot.chainName}.`
    : null;

  return {
    card: walletCard(snapshot, { networkNote }),
    reply: balanceAnswer(snapshot),
    skipModel: true,
    contextNotes: [
      `Connected wallet ${snapshot.address} on ${snapshot.chainName}.`,
      snapshot.native ? `Native balance ${snapshot.native.formatted} ${snapshot.native.symbol}.` : "Native balance unavailable.",
      snapshot.tokens.length ? `Tracked tokens: ${snapshot.tokens.map((token) => `${token.formatted} ${token.symbol}`).join(", ")}.` : "No configured tokens held.",
      enabled.length ? `Supported networks: ${enabled.map((chain) => chain.name).join(", ")}.` : "No networks enabled.",
    ],
  };
}

async function runPortfolio(context: ActionRunContext, config: PublicWalletConfig): Promise<ActionRunResult> {
  const flags = context.featureFlags ?? defaultFeatureFlags;
  if (!flags.portfolio_enabled) {
    return lockedFeatureNotice("Portfolio is in the works", "Cabi cannot show holdings yet. Nothing is being read or estimated while this feature is being built.");
  }
  if (!context.walletAddress) return walletRequired();
  const { snapshot, error } = await loadSnapshot(context, config);
  if (error || !snapshot) {
    return {
      card: noticeCard({ title: "I couldn't read your wallet", message: error ?? "I couldn't read your wallet right now.", tone: "error" }),
      reply: "I couldn't read your wallet right now.",
      skipModel: true,
      contextNotes: [],
    };
  }
  const summary = [
    snapshot.native ? `${snapshot.native.formatted} ${snapshot.native.symbol}` : null,
    ...snapshot.tokens.map((token) => `${token.formatted} $${token.symbol}`),
  ].filter(Boolean).join(", ");

  return {
    card: portfolioCard(snapshot),
    reply: summary ? `On ${snapshot.chainName} you're holding ${summary}.` : `I don't see any tracked balances on ${snapshot.chainName}.`,
    skipModel: true,
    contextNotes: [
      `Wallet ${snapshot.address} on ${snapshot.chainName}.`,
      summary ? `Balances: ${summary}.` : "No tracked balances.",
      "No price data is available, so do not quote any USD value.",
    ],
  };
}

/**
 * Entry point. Given the user's message and verified session context, decides
 * what Cabi should show. Returns `NONE` when the message is ordinary
 * conversation, in which case the caller proceeds to the model unchanged.
 */
export async function runAction(
  message: string,
  context: ActionRunContext = {},
): Promise<ActionRunResult> {
  // Callers that already hold the public config must pass it. The fallback read
  // exists only for direct callers (and tests); it is never reached from the
  // guest chat path, which would otherwise open a database client for a message
  // that must not touch the database at all.
  const config = context.config ?? await getPublicWalletConfig();
  const request = interpretMessage(message, {
    ...context,
    cpuSymbol: config.cpu.ticker,
  });

  switch (request.type) {
    case "NONE":
      return { card: null, reply: null, skipModel: false, contextNotes: [] };
    case "SLASH":
      return runSlash(request.command.command, request.command.rest, context, config);
    case "TRADE":
      return runTrade(request.intent, context, config);
    case "CLARIFY":
      return {
        card: clarifyCard({ question: request.question }),
        reply: request.question,
        skipModel: true,
        contextNotes: [],
      };
    case "WALLET_INFO":
      return runWalletInfo(context, config);
    case "PORTFOLIO":
      return runPortfolio(context, config);
    case "HOLDING":
      return runHolding(request, context, config);
    case "TOKEN_LOOKUP":
      return runTokenLookup(request, context, config);
    case "MEMORY_REMEMBER":
      return {
        card: null,
        reply: null,
        skipModel: false,
        modelHint: "The user asked you to remember something. The memory system handles storage. Confirm naturally in one short sentence without repeating the whole fact back.",
        contextNotes: [],
      };
    case "MEMORY_FORGET":
      return {
        card: null,
        reply: null,
        skipModel: false,
        modelHint: "The user asked you to forget something. The memory system handles removal. Acknowledge briefly.",
        contextNotes: [],
      };
    case "MEMORY_LIST":
      return {
        card: null,
        reply: null,
        skipModel: false,
        modelHint: "The user asked what you remember. Keep it to what you actually know; never invent a memory.",
        contextNotes: [],
      };
    case "BOND":
      return { card: null, reply: null, skipModel: false, contextNotes: [] };
    case "HELP":
      return helpOutcome();
    default:
      return { card: null, reply: null, skipModel: false, contextNotes: [] };
  }
}
