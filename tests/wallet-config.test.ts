import { describe, expect, it } from "vitest";

import { parseWalletProductConfig, redactUnlaunchedCpu } from "@/lib/wallet/config";

const chain = {
  id: 8453,
  name: "Configured EVM Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.example.com",
  blockExplorerUrl: "https://explorer.example.com",
  iconUrl: "",
  enabled: true,
};

const prelaunch = {
  tokenName: "Cat Partner Unit",
  ticker: "CPU",
  launchStatus: "PRELAUNCH" as const,
  contractAddress: "",
  chainId: null,
  clankTradeUrl: "",
  explorerUrl: "",
  xUrl: "",
  websiteUrl: "",
  description: "Cabi's community token.",
};

describe("wallet product configuration", () => {
  it("keeps pre-launch safe without fabricated token details", () => {
    const result = parseWalletProductConfig({ chains: [], primaryChainId: null, cpu: prelaunch });
    expect(result.cpu.launchStatus).toBe("PRELAUNCH");
    expect(result.cpu.contractAddress).toBe("");
    expect(result.cpu.clankTradeUrl).toBe("");
  });

  it("redacts owner-staged launch destinations from the public prelaunch projection", () => {
    const staged = parseWalletProductConfig({
      chains: [chain],
      primaryChainId: chain.id,
      cpu: {
        ...prelaunch,
        contractAddress: "0x000000000000000000000000000000000000dead",
        chainId: chain.id,
        clankTradeUrl: "https://clank.trade/coin/cpu",
        explorerUrl: "https://explorer.example.com/token/cpu",
        xUrl: "https://x.com/cpu",
        websiteUrl: "https://cpu.example.com",
      },
    });
    const result = redactUnlaunchedCpu(staged);
    expect(result.cpu).toMatchObject({
      launchStatus: "PRELAUNCH",
      contractAddress: "",
      chainId: null,
      clankTradeUrl: "",
      explorerUrl: "",
      xUrl: "",
      websiteUrl: "",
    });
  });

  it("rejects invalid EVM contract addresses", () => {
    expect(() => parseWalletProductConfig({
      chains: [chain],
      primaryChainId: chain.id,
      cpu: { ...prelaunch, launchStatus: "LIVE", contractAddress: "0xnot-an-address", chainId: chain.id, clankTradeUrl: "https://clank.trade/coin/cpu" },
    })).toThrow(/valid EVM contract address/u);
  });

  it("requires an enabled chain and exact trade URL for live state", () => {
    expect(() => parseWalletProductConfig({
      chains: [chain],
      primaryChainId: chain.id,
      cpu: { ...prelaunch, launchStatus: "LIVE", contractAddress: "0x000000000000000000000000000000000000dead" },
    })).toThrow(/supported chain|Clank.trade/u);
  });

  it("normalizes a valid address for presentation", () => {
    const result = parseWalletProductConfig({
      chains: [chain],
      primaryChainId: chain.id,
      cpu: { ...prelaunch, launchStatus: "LIVE", contractAddress: "0x000000000000000000000000000000000000dead", chainId: chain.id, clankTradeUrl: "https://clank.trade/coin/cpu" },
    });
    expect(result.cpu.contractAddress).toBe("0x000000000000000000000000000000000000dEaD");
  });

  it("rejects lookalike or credential-bearing Clank.trade URLs", () => {
    for (const clankTradeUrl of [
      "https://clank.trade.evil.example/coin/cpu",
      "https://evil.example/clank.trade/coin/cpu",
      "https://user:secret@clank.trade/coin/cpu",
      "http://clank.trade/coin/cpu",
    ]) {
      expect(() => parseWalletProductConfig({
        chains: [chain],
        primaryChainId: chain.id,
        cpu: { ...prelaunch, launchStatus: "LIVE", contractAddress: "0x000000000000000000000000000000000000dead", chainId: chain.id, clankTradeUrl },
      })).toThrow(/exact HTTPS Clank\.trade/u);
    }
  });
});
