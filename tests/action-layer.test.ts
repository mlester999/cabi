import { describe, expect, it } from "vitest";

import { interpretMessage } from "@/lib/actions/intent";
import { parseActionCard, stripActionCardDebugDetails } from "@/lib/actions/guards";
import { matchingSlashCommands, parseSlashCommand, slashCommands } from "@/lib/actions/slash-commands";
import { clarifyCard, noticeCard, portfolioCard, safeLinks, tokenCard, tradeCard } from "@/lib/actions/cards";
import type { ActionCard } from "@/lib/actions/types";
import type { TokenMetadata } from "@/lib/tokens/metadata";
import type { WalletSnapshot } from "@/lib/wallet-data/types";

const CPU_ADDRESS = "0x1a421A5065316d9b4062939E9959DDEcE6630528";
const CHAIN_ID = 8453;

function token(overrides: Partial<TokenMetadata> = {}): TokenMetadata {
  return {
    address: CPU_ADDRESS,
    symbol: "CPU",
    name: "Cat Partner Unit",
    decimals: 18,
    chainId: CHAIN_ID,
    chainName: "Configured EVM Network",
    isConfiguredCpu: true,
    clankTradeUrl: "https://clank.trade/coin/cpu",
    explorerUrl: "https://explorer.example.com/address/0x1a421A5065316d9b4062939E9959DDEcE6630528",
    origin: "CONFIGURED",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WalletSnapshot> = {}): WalletSnapshot {
  return {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    chainId: CHAIN_ID,
    chainName: "Configured EVM Network",
    native: { chainId: CHAIN_ID, symbol: "ETH", decimals: 18, raw: "1500000000000000000", formatted: "1.5" },
    tokens: [{ address: CPU_ADDRESS, symbol: "CPU", name: "Cat Partner Unit", decimals: 18, raw: "1000000000000000000000", formatted: "1000", configured: true, verifiedUrl: "https://clank.trade/coin/cpu" }],
    supportedChains: [{ id: CHAIN_ID, name: "Configured EVM Network", enabled: true }],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorerUrl: "https://explorer.example.com/address/0x1234567890abcdef1234567890abcdef12345678",
    ...overrides,
  };
}

describe("slash commands", () => {
  it("parses a known command and keeps the rest of the line", () => {
    const parsed = parseSlashCommand("/wallet please");
    expect(parsed.matched).toBe(true);
    if (!parsed.matched) return;
    expect(parsed.command.id).toBe("/wallet");
    expect(parsed.rest).toBe("please");
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    const parsed = parseSlashCommand("   /CPU  ");
    expect(parsed.matched && parsed.command.id).toBe("/cpu");
  });

  it("reports an unknown slash token as unmatched rather than guessing", () => {
    expect(parseSlashCommand("/whatever").matched).toBe(false);
    expect(parseSlashCommand("not a command").matched).toBe(false);
  });

  it("only offers the palette while the command itself is being typed", () => {
    expect(matchingSlashCommands("/").length).toBe(slashCommands.length);
    // Portfolio is a roadmap feature, not a chat command while it is locked.
    expect(matchingSlashCommands("/po")).toEqual([]);
    // Once arguments start, the palette steps out of the way.
    expect(matchingSlashCommands("/wallet now")).toEqual([]);
    expect(matchingSlashCommands("hello")).toEqual([]);
  });

  it("advertises only commands that do something", () => {
    for (const command of slashCommands) {
      expect(command.description.length).toBeGreaterThan(8);
      expect(Boolean(command.href) || Boolean(command.client) || command.id === "/cpu" || command.id === "/wallet" || command.id === "/help").toBe(true);
    }
  });
});

describe("message interpretation", () => {
  it("keeps a locked portfolio request out of the slash command palette", () => {
    const result = interpretMessage("/portfolio");
    expect(result.type).toBe("PORTFOLIO");
  });

  it("extracts buy and sell requests", () => {
    const buy = interpretMessage("buy 0.02 eth of this coin", { selectedToken: { address: CPU_ADDRESS, symbol: "CPU", chainId: CHAIN_ID } });
    expect(buy.type).toBe("TRADE");
    if (buy.type !== "TRADE") return;
    expect(buy.intent.action).toBe("BUY");
    expect(buy.intent.tokenAddress).toBe("0x1a421A5065316d9b4062939E9959DDEcE6630528");

    const sell = interpretMessage("sell 25% of my $CPU");
    expect(sell.type).toBe("TRADE");
    if (sell.type !== "TRADE") return;
    expect(sell.intent.action).toBe("SELL");
    expect(sell.intent.amountType).toBe("PERCENTAGE");
  });

  it("flags an ambiguous ticker for clarification instead of guessing", () => {
    const result = interpretMessage("buy 0.02 eth of $ABC");
    expect(result.type).toBe("TRADE");
    if (result.type !== "TRADE") return;
    expect(result.intent.tokenAddress).toBeUndefined();
    expect(result.needs).toContain("MISSING_TOKEN");
  });

  it("asks for the amount when it is missing", () => {
    const result = interpretMessage("buy $CPU");
    expect(result.type).toBe("TRADE");
    if (result.type !== "TRADE") return;
    expect(result.needs).toContain("MISSING_AMOUNT");
  });

  it("treats a pasted contract address as a token reference", () => {
    const result = interpretMessage(`what is ${CPU_ADDRESS}`);
    expect(result.type).toBe("TOKEN_LOOKUP");
    if (result.type !== "TOKEN_LOOKUP") return;
    expect(result.address?.toLowerCase()).toBe(CPU_ADDRESS.toLowerCase());
  });

  it("refuses a non-Clank.trade link rather than fetching it", () => {
    const result = interpretMessage("open https://evil.example.com/token/0xabc");
    expect(result.type).toBe("CLARIFY");
    if (result.type !== "CLARIFY") return;
    expect(result.reason).toBe("UNSUPPORTED_URL");
  });

  it("accepts a pasted Clank.trade link", () => {
    const result = interpretMessage("look at https://clank.trade/coin/0x1a421A5065316d9b4062939E9959DDEcE6630528");
    expect(result.type).toBe("TOKEN_LOOKUP");
  });

  it("recognises wallet, portfolio and holding questions", () => {
    expect(interpretMessage("what wallet am I connected with?").type).toBe("WALLET_INFO");
    expect(interpretMessage("what network am I on?").type).toBe("WALLET_INFO");
    expect(interpretMessage("how much ETH do I have?").type).toBe("WALLET_INFO");
    expect(interpretMessage("show me my tokens").type).toBe("PORTFOLIO");
    expect(interpretMessage("do I own $CPU?").type).toBe("HOLDING");
  });

  it("recognises memory commands", () => {
    const remember = interpretMessage("Remember that I like small-cap AI coins");
    expect(remember.type).toBe("MEMORY_REMEMBER");
    if (remember.type !== "MEMORY_REMEMBER") return;
    expect(remember.content).toContain("small-cap AI coins");

    expect(interpretMessage("Forget that I like tea").type).toBe("MEMORY_FORGET");
    expect(interpretMessage("what do you remember about me?").type).toBe("MEMORY_LIST");
  });

  it("leaves ordinary conversation to the model", () => {
    expect(interpretMessage("how are you today?").type).toBe("NONE");
    expect(interpretMessage("tell me a story about a cat").type).toBe("NONE");
  });
});

describe("action cards", () => {
  it("builds a token card that offers only the published destinations", () => {
    const card = tokenCard(token());
    expect(card.kind).toBe("TOKEN");
    expect(card.kind === "TOKEN" && card.tokenAddress).toBe(CPU_ADDRESS);
    expect(card.rows.some((row) => row.value === CPU_ADDRESS)).toBe(true);
    expect(card.links.map((link) => link.kind)).toContain("CLANK_TRADE");
  });

  it("says so when metadata could not be read, and still shows the contract", () => {
    const card = tokenCard(token({ origin: "UNRESOLVED", symbol: "", name: "", clankTradeUrl: null, unavailableReason: "I couldn't reach the network." }));
    expect(card.tone).toBe("caution");
    expect(card.message).toContain("couldn't reach");
    expect(card.links.some((link) => link.kind === "CLANK_TRADE")).toBe(false);
  });

  it("never invents a price, quote or fee row", () => {
    const card = tradeCard({
      action: "BUY",
      intent: { action: "BUY", tokenAddress: CPU_ADDRESS, amount: "0.02", amountType: "NATIVE" },
      token: { address: CPU_ADDRESS, symbol: "CPU", name: "Cat Partner Unit" },
      chainName: "Configured EVM Network",
      route: "Clank.trade",
      state: "AWAITING_USER_CONFIRMATION",
      directExecution: false,
      clankTradeUrl: "https://clank.trade/coin/cpu",
    });
    const labels = card.rows.map((row) => row.label.toLowerCase()).join(" ");
    for (const banned of ["price", "market cap", "holders", "slippage", "estimated receive", "gas", "fee", "usd"]) {
      expect(labels).not.toContain(banned);
    }
    expect(card.directExecution).toBe(false);
    expect(card.requiresConfirmation).toBe(true);
  });

  it("marks the trade card as prepare-only while no execution interface exists", () => {
    const card = tradeCard({
      action: "SELL",
      intent: { action: "SELL", tokenAddress: CPU_ADDRESS, amount: "25", amountType: "PERCENTAGE" },
      state: "AWAITING_USER_CONFIRMATION",
      directExecution: false,
    });
    expect(card.subtitle).toMatch(/Clank\.trade/);
    expect(card.tone).toBe("caution");
  });

  it("renders portfolio quantities without any valuation", () => {
    const card = portfolioCard(snapshot());
    const text = JSON.stringify(card).toLowerCase();
    expect(text).toContain("1000");
    expect(text).not.toContain("usd");
    expect(text).not.toContain("$1");
  });

  it("drops unsafe links instead of rendering them", () => {
    const links = safeLinks([
      { label: "ok", url: "https://clank.trade/coin/cpu", kind: "CLANK_TRADE" },
      { label: "internal", url: "/admin/images#recent-generation-runs", kind: "INTERNAL" },
      { label: "js", url: "javascript:alert(1)", kind: "CLANK_TRADE" },
      { label: "http", url: "http://clank.trade/coin/cpu", kind: "CLANK_TRADE" },
      { label: "escaped", url: "/\\evil.test", kind: "INTERNAL" },
      null,
    ]);
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("https://clank.trade/coin/cpu");
    expect(links[1].url).toBe("/admin/images#recent-generation-runs");
  });

  it("builds a clarify card with options when a choice is required", () => {
    const card = clarifyCard({
      question: "Which $ABC do you mean?",
      options: [{ id: "a", label: "ABC One", detail: "0x1a42...0528" }],
    });
    expect(card.kind).toBe("CLARIFY");
    expect(card.options).toHaveLength(1);
    expect(card.tone).toBe("caution");
  });

  it("builds a plain notice card", () => {
    const card = noticeCard({ title: "Connect your wallet first", message: "Connect and sign in." });
    expect(card.kind).toBe("NOTICE");
    expect(card.rows).toHaveLength(0);
  });
});

describe("stored card validation", () => {
  const valid = tokenCard(token());

  it("accepts a card this app produced", () => {
    expect(parseActionCard(valid)).not.toBeNull();
  });

  it("rejects a card with a javascript link", () => {
    const tampered = { ...valid, links: [{ label: "x", url: "javascript:alert(1)", kind: "CLANK_TRADE" }] };
    expect(parseActionCard(tampered)).toBeNull();
  });

  it("rejects a card with a non-HTTPS external link", () => {
    const tampered = { ...valid, links: [{ label: "x", url: "http://clank.trade/coin/cpu", kind: "CLANK_TRADE" }] };
    expect(parseActionCard(tampered)).toBeNull();
  });

  it("rejects an unknown card kind and arbitrary payloads", () => {
    expect(parseActionCard({ kind: "EXECUTE", calldata: "0xdeadbeef" })).toBeNull();
    expect(parseActionCard({ kind: "TOKEN" })).toBeNull();
    expect(parseActionCard(null)).toBeNull();
    expect(parseActionCard("card")).toBeNull();
  });

  it("allows an app-relative internal link but not a protocol-relative one", () => {
    expect(parseActionCard({ ...valid, links: [{ label: "p", url: "/portfolio", kind: "INTERNAL" }] })).not.toBeNull();
    expect(parseActionCard({ ...valid, links: [{ label: "p", url: "//evil.test", kind: "INTERNAL" }] })).toBeNull();
    expect(parseActionCard({ ...valid, links: [{ label: "p", url: "/\\evil.test", kind: "INTERNAL" }] })).toBeNull();
  });

  it("strips owner-preview diagnostics before card persistence", () => {
    const withDetails = { ...valid, debugDetails: { requestId: "owner-only" } } as ActionCard;
    const stripped = stripActionCardDebugDetails(withDetails);
    expect(stripped).not.toHaveProperty("debugDetails");
  });
});
