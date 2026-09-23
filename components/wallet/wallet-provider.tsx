"use client";

import {
  BrowserWallet,
  createWalletConnectOption,
  Eip1193Provider,
  emptyPublicWalletConfig,
  mergeWallet,
  normalizeClientAddress,
  observeBrowserWallets,
  parseChainId,
  PublicWalletConfig,
  switchToConfiguredChain,
  walletRpcMethods,
} from "@/lib/wallet/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WalletLogo } from "@/components/wallet/wallet-logo";
import { Check, ChevronRight, LoaderCircle, ShieldCheck, WalletCards } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type WalletIdentity = { address: string; walletAccountId: string; profileId: string };
type WalletSession = { authenticated: true; wallet: WalletIdentity; expiresAt: string };
type WalletPhase = "idle" | "connecting" | "signing" | "verifying";

type WalletContextValue = {
  config: PublicWalletConfig;
  configLoaded: boolean;
  session: WalletSession | null;
  sessionLoaded: boolean;
  authenticated: boolean;
  authenticatedAt: number | null;
  address: string | null;
  chainId: number | null;
  /** The connected browser wallet, used to show its brand mark. */
  activeWallet: BrowserWallet | null;
  wallets: BrowserWallet[];
  phase: WalletPhase;
  error: string | null;
  openConnect: () => void;
  closeConnect: () => void;
  connect: (wallet: BrowserWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: (targetChainId?: number | null) => Promise<void>;
  chainName: (value?: number | null) => string;
  isWrongNetwork: (requiredChainId?: number | null) => boolean;
  refreshConfig: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

async function readResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" && payload.error.length < 240 ? payload.error : fallback;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicWalletConfig>(emptyPublicWalletConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [activeWallet, setActiveWallet] = useState<BrowserWallet | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [authenticatedAt, setAuthenticatedAt] = useState<number | null>(null);
  const sessionRef = useRef<WalletSession | null>(null);
  const disconnectingRef = useRef(false);

  const refreshConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/public/config", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = await response.json() as PublicWalletConfig;
      if (!Array.isArray(next.chains) || !next.cpu) throw new Error();
      setConfig(next);
    } catch {
      setConfig(emptyPublicWalletConfig);
    } finally {
      setConfigLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshConfig(), 0);
    void (async () => {
      try {
        const response = await fetch("/api/wallet/session", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as WalletSession;
        if (next.authenticated && next.wallet?.address) {
          sessionRef.current = next;
          setSession(next);
        }
      } finally {
        setSessionLoaded(true);
      }
    })();
    return () => window.clearTimeout(timer);
  }, [refreshConfig]);

  useEffect(() => observeBrowserWallets((wallet) => setWallets((current) => mergeWallet(current, wallet))), []);

  useEffect(() => {
    if (!configLoaded) return;
    const walletConnect = createWalletConnectOption(config, process.env.NEXT_PUBLIC_REOWN_PROJECT_ID);
    if (!walletConnect) return;
    const timer = window.setTimeout(() => setWallets((current) => mergeWallet(current, walletConnect)), 0);
    return () => window.clearTimeout(timer);
  }, [config, configLoaded]);

  useEffect(() => {
    if (!session?.wallet.address || provider) return;
    let cancelled = false;
    void (async () => {
      for (const wallet of wallets) {
        if (!wallet.provider) continue;
        try {
          const accounts = await wallet.provider.request<unknown>({ method: "eth_accounts" });
          if (!Array.isArray(accounts)) continue;
          const match = accounts.find((account) => {
            try { return normalizeClientAddress(account) === session.wallet.address; } catch { return false; }
          });
          if (!match || cancelled) continue;
          const currentChain = parseChainId(await wallet.provider.request({ method: walletRpcMethods.chainId }));
          if (!cancelled) { setProvider(wallet.provider); setActiveWallet(wallet); setChainId(currentChain); }
          return;
        } catch { /* A silent read failure should not invalidate the server session. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [provider, session, wallets]);

  const clearLocalSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setProvider(null);
    setActiveWallet(null);
    setChainId(null);
    setAuthenticatedAt(null);
    setPhase("idle");
  }, []);

  const disconnect = useCallback(async () => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    try {
      const response = await fetch("/api/wallet/logout", { method: "POST" });
      if (!response.ok) throw new Error(await readResponseError(response, "Cabi couldn't complete wallet sign-out. Please try again."));
      if (activeWallet?.disconnect && provider) await activeWallet.disconnect(provider).catch(() => undefined);
      clearLocalSession();
      setConnectOpen(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cabi couldn't complete wallet sign-out. Please try again.");
    } finally {
      disconnectingRef.current = false;
    }
  }, [activeWallet, clearLocalSession, provider]);

  useEffect(() => {
    if (!provider) return;
    const onChainChanged = (...args: unknown[]) => setChainId(parseChainId(args[0]));
    const onAccountsChanged = (...args: unknown[]) => {
      const values = args[0];
      if (!Array.isArray(values) || values.length === 0) { void disconnect(); return; }
      try {
        if (normalizeClientAddress(values[0]) !== sessionRef.current?.wallet.address) void disconnect();
      } catch { void disconnect(); }
    };
    const onDisconnect = () => { void disconnect(); };
    provider.on?.("chainChanged", onChainChanged);
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("chainChanged", onChainChanged);
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [disconnect, provider]);

  const connect = useCallback(async (wallet: BrowserWallet) => {
    setError(null);
    setPhase("connecting");
    try {
      const walletProvider = await wallet.connect();
      const accounts = await walletProvider.request<unknown>({ method: walletRpcMethods.accounts });
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("No EVM account was selected.");
      const address = normalizeClientAddress(accounts[0]);
      const nextChainId = parseChainId(await walletProvider.request({ method: walletRpcMethods.chainId }));
      if (!nextChainId) throw new Error("The wallet did not provide a valid EVM network.");

      const nonceResponse = await fetch("/api/wallet/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId: nextChainId }),
      });
      if (!nonceResponse.ok) throw new Error(await readResponseError(nonceResponse, "Cabi couldn't start wallet sign-in."));
      const challenge = await nonceResponse.json() as { message?: unknown };
      if (typeof challenge.message !== "string") throw new Error("Cabi received an invalid sign-in challenge.");

      setPhase("signing");
      const signature = await walletProvider.request<unknown>({ method: walletRpcMethods.signIn, params: [challenge.message, address] });
      if (typeof signature !== "string") throw new Error("The wallet did not return a valid signature.");

      setPhase("verifying");
      const verifyResponse = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: challenge.message, signature }),
      });
      if (!verifyResponse.ok) throw new Error(await readResponseError(verifyResponse, "Cabi couldn't verify that signature."));
      const nextSession = await verifyResponse.json() as WalletSession;
      if (!nextSession.authenticated || !nextSession.wallet?.address) throw new Error("Cabi received an invalid wallet session.");

      sessionRef.current = nextSession;
      setSession(nextSession);
      setProvider(walletProvider);
      setActiveWallet(wallet);
      setChainId(nextChainId);
      setAuthenticatedAt(Date.now());
      setPhase("idle");
      setConnectOpen(false);
    } catch (cause) {
      const message = cause instanceof Error && cause.message && !/reject|denied/iu.test(cause.message)
        ? cause.message
        : "Wallet sign-in was cancelled. Your chat is still available.";
      setError(message);
    } finally {
      setPhase("idle");
    }
  }, []);

  const switchNetwork = useCallback(async (targetChainId?: number | null) => {
    if (!provider) { setError("Reconnect your wallet before switching networks."); setConnectOpen(true); return; }
    const targetId = targetChainId ?? config.primaryChainId;
    const target = config.chains.find((chain) => chain.id === targetId && chain.enabled);
    if (!target) { setError("That network is not available in Cabi's current configuration."); return; }
    setError(null);
    try {
      await switchToConfiguredChain(provider, target);
      setChainId(target.id);
    } catch {
      setError("Your wallet couldn't switch networks. You can keep using saved chats on the current network.");
    }
  }, [config, provider]);

  const chainName = useCallback((value?: number | null) => {
    const id = value ?? chainId;
    if (!id) return "Not connected";
    return config.chains.find((chain) => chain.id === id)?.name ?? `EVM chain ${id}`;
  }, [chainId, config.chains]);

  const isWrongNetwork = useCallback((requiredChainId?: number | null) => {
    if (!chainId) return false;
    if (requiredChainId != null) return chainId !== requiredChainId;
    const enabled = config.chains.filter((chain) => chain.enabled);
    return enabled.length > 0 && !enabled.some((chain) => chain.id === chainId);
  }, [chainId, config.chains]);

  const value = useMemo<WalletContextValue>(() => ({
    config,
    configLoaded,
    session,
    sessionLoaded,
    authenticated: Boolean(session),
    authenticatedAt,
    address: session?.wallet.address ?? null,
    chainId,
    activeWallet,
    wallets,
    phase,
    error,
    openConnect: () => { setError(null); setConnectOpen(true); },
    closeConnect: () => { if (phase === "idle") setConnectOpen(false); },
    connect,
    disconnect,
    switchNetwork,
    chainName,
    isWrongNetwork,
    refreshConfig,
  }), [activeWallet, authenticatedAt, chainId, chainName, config, configLoaded, connect, disconnect, error, isWrongNetwork, phase, refreshConfig, session, sessionLoaded, switchNetwork, wallets]);

  return (
    <WalletContext.Provider value={value}>
      {children}
      <Dialog open={connectOpen} onOpenChange={(open) => { if (!open && phase === "idle") setConnectOpen(false); }}>
        <DialogContent className="glass gap-0 rounded-[28px] border-violet-200/[0.12] bg-[#0b0912] p-0 text-white sm:max-w-[430px]" showCloseButton={phase === "idle"}>
          <div className="p-6 sm:p-7">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.07] text-violet-200"><WalletCards size={21} /></div>
            <DialogHeader className="mt-5 text-left">
              <DialogTitle className="text-xl tracking-[-.025em]">Want me to remember our chats?</DialogTitle>
              <DialogDescription className="mt-1.5 leading-6 text-[#a8a3b3]">Connect your wallet to save conversations, memories, and your bond with Cabi.</DialogDescription>
            </DialogHeader>

            {phase !== "idle" ? (
              <div className="mt-6 rounded-2xl border border-violet-200/10 bg-violet-300/[0.04] p-5 text-center">
                <LoaderCircle className="mx-auto animate-spin text-violet-200" size={24} />
                <p className="mt-3 text-sm font-medium">{phase === "connecting" ? "Opening your wallet…" : phase === "signing" ? "Check your wallet to sign in" : "Verifying your sign-in…"}</p>
                <p className="mt-2 text-xs leading-5 text-[#8e889b]">This signature is only for sign-in. It costs no gas and sends no transaction.</p>
              </div>
            ) : (
              <div className="mt-6 space-y-2">
                {wallets.length > 0 ? wallets.map((wallet) => (
                  <button key={wallet.id} onClick={() => void connect(wallet)} className="focus-ring flex min-h-12 w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 text-left transition hover:border-violet-200/20 hover:bg-violet-300/[0.06]">
                    <WalletLogo wallet={wallet} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{wallet.name}</span>
                    <ChevronRight size={16} className="text-[#625d6d]" />
                  </button>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/[0.09] px-5 py-6 text-center">
                    <p className="text-sm font-medium">No browser wallet found</p>
                    <p className="mt-2 text-xs leading-5 text-[#777180]">Open Cabi in an EVM wallet browser or enable an installed wallet extension, then try again.</p>
                  </div>
                )}
              </div>
            )}

            {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2.5 text-xs leading-5 text-rose-200">{error}</p>}
            <div className="mt-5 flex items-start gap-2.5 text-[11px] leading-5 text-[#777180]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-300" /><p>Signing in is free and does not require a transaction. Cabi only uses your public address as your account.</p></div>
            {session && <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><Check size={14} /> Wallet authenticated</div>}
          </div>
        </DialogContent>
      </Dialog>
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
