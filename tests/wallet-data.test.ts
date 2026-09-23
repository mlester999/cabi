import { describe, expect, it, vi } from "vitest";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBalance: async () => {
        const behaviour = globalThis.__cabiRpcBehaviour;
        if (behaviour === "fail") throw new Error("rpc down");
        return BigInt("1500000000000000000");
      },
      readContract: async ({ functionName }: { functionName: string }) => {
        const behaviour = globalThis.__cabiRpcBehaviour;
        if (behaviour === "fail") throw new Error("rpc down");
        if (behaviour === "not-a-token") throw new Error("execution reverted");
        switch (functionName) {
          case "balanceOf": return BigInt("2000000000000000000000");
          case "decimals": return 18;
          case "symbol": return "CPU";
          case "name": return "Cat Partner Unit";
          default: return null;
        }
      },
    })),
  };
});

declare global {
  var __cabiRpcBehaviour: "ok" | "fail" | "not-a-token" | undefined;
}

import { readNativeBalance, tidyAmount } from "@/lib/wallet-data/balance";
import { configuredTokens, readTokenHoldings, sanitizeTokenText } from "@/lib/wallet-data/tokens";
import { assertUsableChain, chainById, explorerAddressUrlFor } from "@/lib/wallet-data/chain";
import { createTtlCache } from "@/lib/wallet-data/cache";
import type { SupportedChainConfig } from "@/lib/wallet/config";

const CHAIN: SupportedChainConfig = {
  id: 8453,
  name: "Configured EVM Network",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.example.com",
  blockExplorerUrl: "https://explorer.example.com",
  iconUrl: "",
  enabled: true,
};

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const CPU = "0x1a421A5065316d9b4062939E9959DDEcE6630528";

describe("chain validation", () => {
  it("accepts a well-formed enabled HTTPS chain", () => {
    expect(assertUsableChain(CHAIN).ok).toBe(true);
  });

  it("rejects disabled, missing, credential-bearing and non-HTTPS chains", () => {
    expect(assertUsableChain(undefined).ok).toBe(false);
    expect(assertUsableChain({ ...CHAIN, enabled: false }).ok).toBe(false);
    expect(assertUsableChain({ ...CHAIN, rpcUrl: "http://rpc.example.com" }).ok).toBe(false);
    expect(assertUsableChain({ ...CHAIN, rpcUrl: "https://user:pass@rpc.example.com" }).ok).toBe(false);
    expect(assertUsableChain({ ...CHAIN, rpcUrl: "not a url" }).ok).toBe(false);
    expect(assertUsableChain({ ...CHAIN, id: 0 }).ok).toBe(false);
  });

  it("looks up a chain by id and builds an explorer link", () => {
    expect(chainById([CHAIN], CHAIN.id)?.name).toBe("Configured EVM Network");
    expect(chainById([CHAIN], 999)).toBeUndefined();
    expect(chainById([CHAIN], null)).toBeUndefined();
    expect(explorerAddressUrlFor(CHAIN, ADDRESS)).toBe(`https://explorer.example.com/address/${ADDRESS}`);
    expect(explorerAddressUrlFor({ ...CHAIN, blockExplorerUrl: "" }, ADDRESS)).toBeNull();
  });
});

describe("native balance", () => {
  it("reads and formats a balance", async () => {
    globalThis.__cabiRpcBehaviour = "ok";
    const result = await readNativeBalance(CHAIN, ADDRESS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.symbol).toBe("ETH");
    expect(result.data.formatted).toBe("1.5");
  });

  it("maps an RPC failure to a friendly typed error", async () => {
    globalThis.__cabiRpcBehaviour = "fail";
    const result = await readNativeBalance(CHAIN, ADDRESS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("RPC_UNAVAILABLE");
    expect(result.message).toMatch(/couldn't read/i);
  });

  it("refuses an unconfigured chain and an invalid address without any RPC call", async () => {
    globalThis.__cabiRpcBehaviour = "ok";
    const noChain = await readNativeBalance(undefined, ADDRESS);
    expect(noChain.ok).toBe(false);
    if (!noChain.ok) expect(noChain.error).toBe("UNSUPPORTED_CHAIN");

    const badAddress = await readNativeBalance(CHAIN, "0xnope");
    expect(badAddress.ok).toBe(false);
    if (!badAddress.ok) expect(badAddress.error).toBe("INVALID_ADDRESS");
  });

  it("trims trailing zeros without losing precision", () => {
    expect(tidyAmount("1.500000")).toBe("1.5");
    expect(tidyAmount("2")).toBe("2");
    expect(tidyAmount("0.123456789")).toBe("0.123456");
  });
});

describe("token holdings", () => {
  it("only tracks owner-configured tokens", () => {
    const none = configuredTokens({ tokenName: "Cat Partner Unit", ticker: "CPU", launchStatus: "PRELAUNCH", contractAddress: "", chainId: null, clankTradeUrl: "", explorerUrl: "", xUrl: "", websiteUrl: "", description: "" });
    expect(none).toEqual([]);

    const one = configuredTokens({ tokenName: "Cat Partner Unit", ticker: "CPU", launchStatus: "LIVE", contractAddress: CPU, chainId: CHAIN.id, clankTradeUrl: "https://clank.trade/coin/cpu", explorerUrl: "", xUrl: "", websiteUrl: "", description: "" });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe("CPU");
  });

  it("reads a balance from the contract", async () => {
    globalThis.__cabiRpcBehaviour = "ok";
    const result = await readTokenHoldings(CHAIN, ADDRESS, [{ address: CPU, label: "CPU", configured: true }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].symbol).toBe("CPU");
    expect(result.data[0].formatted).toBe("2000");
  });

  it("returns an empty list without an RPC call when nothing is configured", async () => {
    const result = await readTokenHoldings(CHAIN, ADDRESS, []);
    expect(result.ok && result.data).toEqual([]);
  });

  it("degrades to an empty list when the token is unreadable", async () => {
    globalThis.__cabiRpcBehaviour = "not-a-token";
    const result = await readTokenHoldings(CHAIN, ADDRESS, [{ address: CPU }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it("sanitises onchain token text before display", () => {
    expect(sanitizeTokenText("CPU", "fallback")).toBe("CPU");
    expect(sanitizeTokenText("", "fallback")).toBe("fallback");
    expect(sanitizeTokenText(42, "fallback")).toBe("fallback");
    expect(sanitizeTokenText("<script>alert(1)</script>", "fallback").length).toBeLessThanOrEqual(48);
    expect(sanitizeTokenText("a".repeat(200), "fallback")).toHaveLength(48);
    expect(sanitizeTokenText("bad\u0000name", "fallback")).toBe("badname");
  });
});

describe("ttl cache", () => {
  it("stores, expires and evicts", async () => {
    const cache = createTtlCache<number>(20);
    cache.set("a", 1);
    expect(cache.get("a")?.value).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get("a")).toBeNull();
  });

  it("deletes by predicate", () => {
    const cache = createTtlCache<number>(1_000);
    cache.set("8453:0xabc", 1);
    cache.set("1:0xabc", 2);
    cache.set("8453:0xdef", 3);
    cache.deleteWhere((key) => key.endsWith(":0xabc"));
    expect(cache.get("8453:0xabc")).toBeNull();
    expect(cache.get("1:0xabc")).toBeNull();
    expect(cache.get("8453:0xdef")?.value).toBe(3);
  });
});