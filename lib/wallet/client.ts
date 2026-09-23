import { getAddress, isAddress } from "viem";

export type PublicChain = {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  blockExplorerUrl: string;
  iconUrl: string;
  enabled: boolean;
};

export type PublicCpuConfig = {
  tokenName: string;
  ticker: string;
  launchStatus: "PRELAUNCH" | "LIVE";
  contractAddress: string;
  chainId: number | null;
  clankTradeUrl: string;
  explorerUrl: string;
  xUrl: string;
  websiteUrl: string;
  description: string;
};

export type PublicWalletConfig = {
  chains: PublicChain[];
  primaryChainId: number | null;
  cpu: PublicCpuConfig;
};

export type Eip1193Request = { method: string; params?: readonly unknown[] | Record<string, unknown> };

export type Eip1193Provider = {
  request<T = unknown>(request: Eip1193Request): Promise<T>;
  on?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
};

export type BrowserWallet = {
  id: string;
  name: string;
  rdns?: string;
  icon?: string;
  provider?: Eip1193Provider;
  connect: () => Promise<Eip1193Provider>;
  disconnect?: (provider: Eip1193Provider) => Promise<void>;
};

type Eip6963Detail = {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Eip1193Provider;
};

export const walletRpcMethods = {
  accounts: "eth_requestAccounts",
  chainId: "eth_chainId",
  signIn: "personal_sign",
  switchChain: "wallet_switchEthereumChain",
  addChain: "wallet_addEthereumChain",
} as const;

export const emptyPublicWalletConfig: PublicWalletConfig = {
  chains: [],
  primaryChainId: null,
  cpu: {
    tokenName: "Cat Partner Unit",
    ticker: "CPU",
    launchStatus: "PRELAUNCH",
    contractAddress: "",
    chainId: null,
    clankTradeUrl: "",
    explorerUrl: "",
    xUrl: "",
    websiteUrl: "",
    description: "Cabi's community token, built for the Cat Partner Unit ecosystem.",
  },
};

export function normalizeClientAddress(value: unknown) {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new Error("The wallet returned an invalid EVM address.");
  return getAddress(value.toLowerCase());
}

export function shortenAddress(address: string, leading = 6, trailing = 4) {
  if (address.length <= leading + trailing + 1) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

export function parseChainId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const parsed = value.startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function chainIdHex(chainId: number) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain ID.");
  return `0x${chainId.toString(16)}`;
}

export function explorerAddressUrl(chain: PublicChain | undefined, address: string) {
  if (!chain?.blockExplorerUrl || !isAddress(address, { strict: false })) return null;
  return `${chain.blockExplorerUrl.replace(/\/$/u, "")}/address/${getAddress(address.toLowerCase())}`;
}

export async function switchToConfiguredChain(provider: Eip1193Provider, chain: PublicChain) {
  const hexadecimalId = chainIdHex(chain.id);
  try {
    await provider.request({ method: walletRpcMethods.switchChain, params: [{ chainId: hexadecimalId }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: walletRpcMethods.addChain,
      params: [{
        chainId: hexadecimalId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrl],
        blockExplorerUrls: chain.blockExplorerUrl ? [chain.blockExplorerUrl] : undefined,
        iconUrls: chain.iconUrl?.startsWith("https://") ? [chain.iconUrl] : undefined,
      }],
    });
  }
}

export function observeBrowserWallets(onWallet: (wallet: BrowserWallet) => void) {
  if (typeof window === "undefined") return () => undefined;
  const seen = new Set<string>();
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.provider || !detail.info?.uuid || seen.has(detail.info.uuid)) return;
    seen.add(detail.info.uuid);
    onWallet({ id: detail.info.uuid, name: detail.info.name, rdns: detail.info.rdns, icon: detail.info.icon, provider: detail.provider, connect: async () => detail.provider });
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const fallbackTimer = window.setTimeout(() => {
    const ethereum = (window as typeof window & { ethereum?: Eip1193Provider }).ethereum;
    if (ethereum && seen.size === 0) onWallet({ id: "injected", name: "Browser wallet", provider: ethereum, connect: async () => ethereum });
  }, 250);

  return () => {
    window.clearTimeout(fallbackTimer);
    window.removeEventListener("eip6963:announceProvider", announce);
  };
}

export function mergeWallet(current: BrowserWallet[], candidate: BrowserWallet) {
  if (current.some((wallet) => wallet.id === candidate.id || (candidate.provider && wallet.provider === candidate.provider))) return current;
  return [...current, candidate].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Creates the opt-in WalletConnect/Reown choice. Only authentication and chain
 * management RPC methods are requested; Cabi never asks the connector for a
 * transaction, token approval, balance, or history capability.
 */
export function createWalletConnectOption(config: PublicWalletConfig, projectId: string | undefined): BrowserWallet | null {
  const id = projectId?.trim();
  const chains = config.chains.filter((chain) => chain.enabled);
  if (!id || chains.length === 0) return null;
  const primary = chains.find((chain) => chain.id === config.primaryChainId) ?? chains[0];
  let connectedProvider: (Eip1193Provider & { disconnect?: () => Promise<void> }) | null = null;

  return {
    id: "walletconnect",
    name: "WalletConnect",
    rdns: "com.walletconnect",
    connect: async () => {
      if (connectedProvider) return connectedProvider;
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const provider = await EthereumProvider.init({
        projectId: id,
        chains: [primary.id],
        optionalChains: chains.filter((chain) => chain.id !== primary.id).map((chain) => chain.id),
        rpcMap: Object.fromEntries(chains.map((chain) => [chain.id, chain.rpcUrl])),
        showQrModal: true,
        methods: [walletRpcMethods.signIn],
        optionalMethods: [walletRpcMethods.accounts, walletRpcMethods.switchChain, walletRpcMethods.addChain],
        events: ["accountsChanged", "chainChanged", "disconnect"],
        metadata: {
          name: "Cabi — Cat Partner Unit",
          description: "Optional wallet sign-in for saved Cabi chats.",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.png`],
        },
      });
      if (!provider.connected) await provider.connect();
      connectedProvider = provider as unknown as Eip1193Provider & { disconnect?: () => Promise<void> };
      return connectedProvider;
    },
    disconnect: async (provider) => {
      const candidate = provider as Eip1193Provider & { disconnect?: () => Promise<void> };
      await candidate.disconnect?.();
      connectedProvider = null;
    },
  };
}
