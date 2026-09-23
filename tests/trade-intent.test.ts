import { describe, expect, it } from "vitest";

import { createClankTradeProvider } from "@/lib/trading/clankTrade";
import { clarificationFor, extractTradeIntent, tradeActionLabels } from "@/lib/trading/intent";
import { buildTransactionRequest } from "@/lib/trading/provider";
import { canTransition, initialTradeSession, prepareTradeSummary, tradeReducer, type TradeSession } from "@/lib/trading/state";
import { parseClankTradeUrl, type TradeIntent } from "@/lib/trading/types";
import { assertClankLink, assertTransactionRequestMatchesIntent, parseTradeIntent } from "@/lib/trading/validation";

const TOKEN = "0x00000000000000000000000000000000000000a1";
const CHAIN_ID = 8453;

const configuredCpu = {
  address: "0x00000000000000000000000000000000000000c1",
  url: "https://clank.trade/coin/cpu",
  symbol: "CPU",
  name: "Cat Partner Unit",
};

function sessionAfter(...events: Parameters<typeof tradeReducer>[1][]): TradeSession {
  return events.reduce<TradeSession>((state, event) => tradeReducer(state, event), initialTradeSession);
}

describe("structured trade intents", () => {
  it("extracts a valid buy command", () => {
    const result = extractTradeIntent("buy 0.02 eth of $ABC");
    expect(result.status).toBe("intent");
    if (result.status !== "intent") return;
    expect(result.intent.action).toBe("BUY");
    expect(result.intent.amount).toBe("0.02");
    expect(result.intent.amountType).toBe("NATIVE");
    expect(result.intent.tokenSymbol).toBe("ABC");
    expect(result.intent.source).toBe("CLANK_TRADE");
  });

  it("extracts a valid sell command with a percentage", () => {
    const result = extractTradeIntent("sell 25% of my $ABC");
    expect(result.status).toBe("intent");
    if (result.status !== "intent") return;
    expect(result.intent.action).toBe("SELL");
    expect(result.intent.amountType).toBe("PERCENTAGE");
    expect(result.intent.amount).toBe("25");
  });

  it("resolves 'this coin' from the on-screen selection instead of guessing", () => {
    const result = extractTradeIntent("buy 0.02 eth of this coin", {
      selectedToken: { address: TOKEN, symbol: "PICK", chainId: CHAIN_ID },
    });
    expect(result.status).toBe("intent");
    if (result.status !== "intent") return;
    expect(result.intent.tokenAddress).toBe("0x00000000000000000000000000000000000000A1");
    expect(result.needs).toHaveLength(0);
  });

  it("flags an ambiguous token instead of picking one", () => {
    const result = extractTradeIntent("buy 0.02 eth of $ABC");
    expect(result.status).toBe("intent");
    if (result.status !== "intent") return;
    // A bare ticker never resolves to an address on its own.
    expect(result.intent.tokenAddress).toBeUndefined();
    expect(result.needs).toContain("MISSING_TOKEN");
  });

  it("flags an ambiguous amount", () => {
    const result = extractTradeIntent("buy $ABC");
    expect(result.status).toBe("intent");
    if (result.status !== "intent") return;
    expect(result.needs).toContain("MISSING_AMOUNT");
  });

  it("extracts contract, open, and network commands", () => {
    const selectedToken = { address: TOKEN, symbol: "PICK", chainId: CHAIN_ID };

    const contract = extractTradeIntent("show me the contract", { selectedToken });
    expect(contract.status === "intent" && contract.intent.action).toBe("COPY_CONTRACT");

    const open = extractTradeIntent("open this coin on clank.trade", { selectedToken });
    expect(open.status === "intent" && open.intent.action).toBe("OPEN_TOKEN");

    const network = extractTradeIntent("switch me to the right network", { chainId: CHAIN_ID });
    expect(network.status === "intent" && network.intent.action).toBe("SWITCH_NETWORK");
  });

  it("ignores ordinary conversation", () => {
    expect(extractTradeIntent("how are you today?").status).toBe("none");
    expect(extractTradeIntent("what is Clank.trade?").status).toBe("none");
  });

  it("refuses to process anything that looks like a wallet secret", () => {
    const result = extractTradeIntent("here is my seed phrase: buy 1 eth");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.reason).toMatch(/never asks for/u);
  });

  it("proves a generated intent cannot express a transaction", () => {
    const hostile = {
      action: "BUY",
      tokenSymbol: "ABC",
      amount: "1",
      amountType: "NATIVE",
      to: "0x00000000000000000000000000000000000000a1",
      data: "0xdeadbeef",
      value: "1000000000000000000",
      gas: "21000",
    };
    expect(parseTradeIntent(hostile)).toEqual({ status: "invalid", reason: "CALLDATA_REJECTED" });
    for (const key of ["data", "calldata", "to", "value", "gas", "nonce", "privateKey", "mnemonic", "execute"]) {
      expect(parseTradeIntent({ action: "BUY", [key]: "x" }).status).toBe("invalid");
    }
  });

  it("validates a well-formed intent and rejects malformed values", () => {
    const parsed = parseTradeIntent({
      action: "BUY",
      tokenAddress: TOKEN,
      amountType: "NATIVE",
      amount: "0.02",
      chainId: CHAIN_ID,
      source: "CLANK_TRADE",
    });
    expect(parsed.status).toBe("valid");
    if (parsed.status !== "valid") return;
    expect(parsed.intent.tokenAddress).toBe("0x00000000000000000000000000000000000000A1");

    expect(parseTradeIntent({ action: "LAUNCH_MISSILES" }).status).toBe("invalid");
    expect(parseTradeIntent({ action: "BUY", tokenAddress: "0xnot-an-address" }).status).toBe("invalid");
    expect(parseTradeIntent({ action: "BUY", amount: "1e18" }).status).toBe("invalid");
    expect(parseTradeIntent({ action: "BUY", amount: "0", amountType: "PERCENTAGE" }).status).toBe("invalid");
    expect(parseTradeIntent({ action: "BUY", amount: "150", amountType: "PERCENTAGE" }).status).toBe("invalid");
    expect(parseTradeIntent({ action: "BUY", amount: "25", amountType: "PERCENTAGE" }).status).toBe("valid");
    expect(parseTradeIntent("buy").status).toBe("invalid");
  });

  it("provides a question for every clarification reason", () => {
    const intent: TradeIntent = { action: "BUY", tokenSymbol: "ABC" };
    for (const reason of ["MISSING_TOKEN", "MISSING_AMOUNT", "AMBIGUOUS_TOKEN", "AMBIGUOUS_AMOUNT", "UNSUPPORTED_ACTION"] as const) {
      expect(clarificationFor(reason, intent).question.length).toBeGreaterThan(8);
    }
  });

  it("labels every trade action", () => {
    for (const action of ["BUY", "SELL", "OPEN_TOKEN", "COPY_CONTRACT", "SWITCH_NETWORK"] as const) {
      expect(tradeActionLabels[action].length).toBeGreaterThan(0);
    }
  });
});

describe("trade confirmation requirement", () => {
  const intent: TradeIntent = { action: "BUY", tokenAddress: TOKEN, amount: "0.02", amountType: "NATIVE" };

  it("walks the full happy path only through an explicit confirmation", () => {
    const session = sessionAfter(
      { type: "INTENT_DETECTED", intent },
      { type: "FETCHING_QUOTE" },
      { type: "QUOTE_READY", summary: [{ label: "Token", value: "$ABC" }] },
      { type: "AWAITING_USER_CONFIRMATION" },
      { type: "CONFIRM" },
      { type: "SUBMITTED", hash: "0xabc" },
      { type: "CONFIRMED", hash: "0xabc" },
    );
    expect(session.state).toBe("CONFIRMED");
    expect(session.confirmedByUser).toBe(true);
  });

  it("cannot reach the wallet without a user confirmation", () => {
    const prepared = sessionAfter(
      { type: "INTENT_DETECTED", intent },
      { type: "FETCHING_QUOTE" },
      { type: "QUOTE_READY", summary: [] },
      { type: "AWAITING_USER_CONFIRMATION" },
    );
    expect(prepared.state).toBe("AWAITING_USER_CONFIRMATION");
    expect(prepared.confirmedByUser).toBe(false);

    expect(tradeReducer(prepared, { type: "SUBMITTED", hash: "0x1" }).state).toBe("AWAITING_USER_CONFIRMATION");
    expect(tradeReducer(prepared, { type: "CONFIRMED" }).state).toBe("AWAITING_USER_CONFIRMATION");
    expect(canTransition("QUOTE_READY", "AWAITING_WALLET")).toBe(false);
    expect(canTransition("IDLE", "AWAITING_WALLET")).toBe(false);
    expect(canTransition("NEEDS_CLARIFICATION", "AWAITING_WALLET")).toBe(false);
    expect(canTransition("AWAITING_USER_CONFIRMATION", "AWAITING_WALLET")).toBe(true);
  });

  it("handles a wallet rejection without sending anything", () => {
    const session = sessionAfter(
      { type: "INTENT_DETECTED", intent },
      { type: "FETCHING_QUOTE" },
      { type: "QUOTE_READY", summary: [] },
      { type: "AWAITING_USER_CONFIRMATION" },
      { type: "CONFIRM" },
      { type: "WALLET_REJECTED" },
    );
    expect(session.state).toBe("REJECTED_BY_USER");
    expect(session.confirmedByUser).toBe(false);
    expect(session.hash).toBeNull();
    expect(session.message).toMatch(/cancelled/u);
  });

  it("marks an expired quote and refuses to continue", () => {
    const expired = sessionAfter(
      { type: "INTENT_DETECTED", intent },
      { type: "FETCHING_QUOTE" },
      { type: "QUOTE_READY", summary: [], expiresAt: Date.now() - 1 },
      { type: "EXPIRED" },
    );
    expect(expired.state).toBe("EXPIRED_QUOTE");
    expect(tradeReducer(expired, { type: "CONFIRM" }).state).toBe("EXPIRED_QUOTE");
  });

  it("resets cleanly from any state", () => {
    const dirty = sessionAfter({ type: "INTENT_DETECTED", intent }, { type: "CONFIRM" });
    expect(tradeReducer(dirty, { type: "RESET" })).toEqual(initialTradeSession);
  });
});

describe("Clank.trade fallback safety", () => {
  const provider = createClankTradeProvider({ configuredCpu });

  it("reports that direct transactions are not available", () => {
    expect(provider.supportsDirectTransactions).toBe(false);
  });

  it("never fabricates a quote or a transaction", async () => {
    const token = { address: TOKEN, symbol: "ABC", name: "ABC", chainId: CHAIN_ID, origin: "USER_PROVIDED" as const, verified: false };
    expect(await provider.getQuote({ action: "BUY" }, token)).toBeNull();
    expect(await provider.prepareBuy({ action: "BUY" }, token, null)).toBeNull();
    expect(await provider.prepareSell({ action: "SELL" }, token, null)).toBeNull();
  });

  it("resolves a known contract address and marks unverified tokens honestly", async () => {
    const [token] = await provider.resolveToken({ address: TOKEN, chainId: CHAIN_ID });
    expect(token.address).toBe("0x00000000000000000000000000000000000000A1");
    expect(token.verified).toBe(false);
    expect(provider.tokenPageUrl(token)).toBeNull();
  });

  it("resolves the configured $CPU coin to its verified page", async () => {
    const [token] = await provider.resolveToken({ symbol: "CPU", chainId: CHAIN_ID });
    expect(token.address.toLowerCase()).toBe(configuredCpu.address);
    expect(token.verified).toBe(true);
    expect(provider.tokenPageUrl(token)).toBe("https://clank.trade/coin/cpu");
  });

  it("resolves an unknown ticker to nothing rather than guessing", async () => {
    expect(await provider.resolveToken({ symbol: "PEPE" })).toEqual([]);
    expect(await provider.resolveToken({ address: "0xnot-an-address" })).toEqual([]);
  });

  it("only ever returns exact-host HTTPS Clank.trade links", () => {
    expect(parseClankTradeUrl("https://clank.trade/coin/cpu")).toBe("https://clank.trade/coin/cpu");
    expect(parseClankTradeUrl("https://www.clank.trade/coin/cpu")).not.toBeNull();
    expect(parseClankTradeUrl("http://clank.trade/coin/cpu")).toBeNull();
    expect(parseClankTradeUrl("https://clank.trade.evil.test/coin/cpu")).toBeNull();
    expect(parseClankTradeUrl("https://evil.test/clank.trade/coin")).toBeNull();
    expect(parseClankTradeUrl("javascript:alert(1)")).toBeNull();
    expect(parseClankTradeUrl("/coin/cpu")).toBeNull();
    expect(parseClankTradeUrl("https://user:pass@clank.trade/coin/cpu")).toBeNull();
    expect(assertClankLink("https://evil.test").ok).toBe(false);
    expect(assertClankLink("https://clank.trade/coin/cpu").ok).toBe(true);
  });

  it("falls back to a verified Clank.trade link instead of a transaction", async () => {
    const prepared = await prepareTradeSummary(
      { action: "BUY", tokenSymbol: "CPU", amount: "0.02", amountType: "NATIVE" },
      provider,
      { chainName: "Base" },
    );
    expect(prepared.state).toBe("UNSUPPORTED");
    expect(prepared.prepared.kind).toBe("EXTERNAL_LINK");
    if (prepared.prepared.kind !== "EXTERNAL_LINK") return;
    expect(prepared.prepared.url).toBe("https://clank.trade/coin/cpu");
    const labels = prepared.summary.map((row) => row.label);
    expect(labels).toContain("Contract");
    expect(labels).toContain("Estimated receive");
    // A fee is only ever shown as "Not available", never invented.
    expect(prepared.summary.find((row) => row.label === "Estimated network fee")?.value).toBe("Not available");
  });

  it("asks for clarification when a token cannot be resolved", async () => {
    const prepared = await prepareTradeSummary({ action: "BUY", tokenSymbol: "PEPE", amount: "1", amountType: "NATIVE" }, provider, {});
    expect(prepared.state).toBe("NEEDS_CLARIFICATION");
    expect(prepared.clarification?.reason).toBe("AMBIGUOUS_TOKEN");
    expect(prepared.prepared.kind).toBe("NONE");
  });

  it("treats a network switch as wallet-only with no transaction", async () => {
    const prepared = await prepareTradeSummary({ action: "SWITCH_NETWORK", chainId: CHAIN_ID }, provider, { chainName: "Base" });
    expect(prepared.state).toBe("AWAITING_USER_CONFIRMATION");
    expect(prepared.prepared.kind).toBe("WALLET_ONLY");
  });
});

describe("transaction construction boundary", () => {
  const intent: TradeIntent = { action: "BUY", tokenAddress: TOKEN, chainId: CHAIN_ID, amount: "1", amountType: "NATIVE" };

  it("rejects malformed prepared transactions", () => {
    expect(() => buildTransactionRequest({ chainId: CHAIN_ID, to: "0xnope", data: "0x", value: "0" })).toThrow();
    expect(() => buildTransactionRequest({ chainId: CHAIN_ID, to: TOKEN, data: "not-hex", value: "0" })).toThrow(/INVALID_CALLDATA/u);
    expect(() => buildTransactionRequest({ chainId: CHAIN_ID, to: TOKEN, data: "0x", value: "-1" })).toThrow(/INVALID_VALUE/u);
    expect(() => buildTransactionRequest({ chainId: 0, to: TOKEN, data: "0x", value: "0" })).toThrow(/INVALID_CHAIN/u);
    expect(() => buildTransactionRequest({ chainId: CHAIN_ID, to: TOKEN, data: "0x", value: "0", gas: "many" })).toThrow(/INVALID_GAS/u);
  });

  it("normalises a well-formed prepared transaction", () => {
    const built = buildTransactionRequest({ chainId: CHAIN_ID, to: TOKEN.toLowerCase(), data: "0xabcdef", value: "1000" });
    expect(built.to).toBe("0x00000000000000000000000000000000000000A1");
    expect(built.chainId).toBe(CHAIN_ID);
  });

  it("refuses a transaction that does not match the intent it came from", () => {
    expect(assertTransactionRequestMatchesIntent({ to: TOKEN, data: "0x", value: "0", chainId: CHAIN_ID }, intent)).toEqual({ ok: true });
    expect(assertTransactionRequestMatchesIntent({ to: TOKEN, data: "0x", value: "0", chainId: 1 }, intent).ok).toBe(false);
    expect(assertTransactionRequestMatchesIntent({ to: "0xbad", data: "0x", value: "0", chainId: CHAIN_ID }, intent).ok).toBe(false);
    expect(assertTransactionRequestMatchesIntent({ to: TOKEN, data: "0x", value: "1", chainId: CHAIN_ID }, { action: "COPY_CONTRACT", tokenAddress: TOKEN }).ok).toBe(false);
  });
});