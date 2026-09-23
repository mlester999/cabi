import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createWalletConnectOption,
  parseChainId,
  switchToConfiguredChain,
  walletRpcMethods,
  type Eip1193Provider,
  type PublicChain,
} from "@/lib/wallet/client";
import { shouldImportGuestChat, shouldPersistChat } from "@/lib/wallet/persistence";

const chain: PublicChain = {
  id: 8453,
  name: "Configured EVM Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.example.com",
  blockExplorerUrl: "https://explorer.example.com",
  iconUrl: "",
  enabled: true,
};

describe("wallet client safety", () => {
  it("exposes authentication and network RPC methods, never a transaction or approval method", () => {
    const methods = Object.values(walletRpcMethods);
    expect(methods).toContain("personal_sign");
    expect(methods).toContain("wallet_switchEthereumChain");
    expect(methods.join(" ")).not.toMatch(/sendTransaction|signTransaction|wallet_watchAsset|approve/iu);
  });

  it("contains no UI request for private keys, seed phrases, or recovery phrases", () => {
    const surface = [
      "components/wallet/wallet-provider.tsx",
      "components/wallet/wallet-button.tsx",
      "components/cabi/cabi-experience.tsx",
      "components/settings/settings-experience.tsx",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(surface).not.toMatch(/(?:enter|paste|provide|send|type).{0,40}(?:private key|seed phrase|recovery phrase)/iu);
  });

  it("switches an existing chain with the standard EVM method", async () => {
    const request = vi.fn(async () => null);
    await switchToConfiguredChain({ request } as Eip1193Provider, chain);
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  });

  it("adds only the centrally configured chain when the wallet reports it missing", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("missing"), { code: 4902 });
      return null;
    });
    await switchToConfiguredChain({ request } as unknown as Eip1193Provider, chain);
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x2105",
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrl],
        blockExplorerUrls: [chain.blockExplorerUrl],
        iconUrls: undefined,
      }],
    });
  });

  it("handles unsupported or absent WalletConnect configuration without breaking injected wallets", () => {
    expect(createWalletConnectOption({ chains: [], primaryChainId: null, cpu: {
      tokenName: "Cat Partner Unit", ticker: "CPU", launchStatus: "PRELAUNCH", contractAddress: "", chainId: null,
      clankTradeUrl: "", explorerUrl: "", xUrl: "", websiteUrl: "", description: "",
    } }, "project-id")).toBeNull();
    expect(parseChainId("0x2105")).toBe(8453);
    expect(parseChainId("not-a-chain")).toBeNull();
  });
});

describe("wallet persistence policy", () => {
  it("never persists a guest and respects Keep Temporary after authentication", () => {
    expect(shouldPersistChat(null, true)).toBe(false);
    expect(shouldPersistChat("wallet-a", false)).toBe(false);
    expect(shouldPersistChat("wallet-a", undefined)).toBe(true);
  });

  it("imports a guest chat only for the explicit Save Chat decision", () => {
    expect(shouldImportGuestChat("save")).toBe(true);
    expect(shouldImportGuestChat("temporary")).toBe(false);
  });
});
