"use client";

import { ArrowLeft, Check, Copy, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { shortAddress } from "@/lib/wallet-data/types";

type Snapshot = {
  address: string;
  chainId: number;
  chainName: string;
  native: { symbol: string; formatted: string } | null;
  tokens: Array<{ address: string; symbol: string; name: string; formatted: string; verifiedUrl?: string }>;
  supportedChains: Array<{ id: number; name: string; enabled: boolean }>;
  explorerUrl: string | null;
};

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "error"; message: string }
  | { phase: "ready"; snapshot: Snapshot; updatedAt: number; stale: boolean };

/**
 * Portfolio.
 *
 * Reads from the same trusted wallet service the chat action layer uses, via
 * `/api/portfolio`, so the two can never disagree. Prices do not exist in this
 * product - there is no verified market-data source - so this renders quantities
 * only and says so rather than showing a fabricated USD figure.
 */
export function PortfolioExperience() {
  const wallet = useWallet();
  const [state, setState] = useState<State>({ phase: "loading" });
  // Derived, not stored: a signed-out visitor is disconnected regardless of what
  // any in-flight request returned.
  const view: State = wallet.sessionLoaded && !wallet.authenticated ? { phase: "disconnected" } : state;
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (options: { fresh?: boolean } = {}) => {
    setState({ phase: "loading" });
    try {
      const response = await fetch(`/api/portfolio${options.fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json() as { connected?: boolean; snapshot?: Snapshot; updatedAt?: number; stale?: boolean; message?: string };
      if (!payload.connected) { setState({ phase: "disconnected" }); return; }
      if (!payload.snapshot) { setState({ phase: "error", message: payload.message ?? "I couldn't read your wallet right now." }); return; }
      setState({ phase: "ready", snapshot: payload.snapshot, updatedAt: payload.updatedAt ?? Date.now(), stale: Boolean(payload.stale) });
    } catch {
      setState({ phase: "error", message: "I couldn't read your wallet right now." });
    }
  }, []);

  // Wait for the session to settle so we never fire an unauthenticated read.
  // Only fetch once the session has settled and a wallet is actually signed in.
  // The disconnected view is derived during render rather than pushed into
  // state here, which avoids a cascading render on every session change.
  useEffect(() => {
    if (!wallet.sessionLoaded || !wallet.authenticated) return;
    // Deferred by a tick so the fetch starts after this render commits rather
    // than synchronously during the effect. Same pattern as SettingsExperience.
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, wallet.authenticated, wallet.sessionLoaded]);

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <MiniCabi className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-.03em]">Portfolio</h1>
            <p className="mt-1 truncate text-sm text-[#777180]">What your wallet holds on the network Cabi is set to.</p>
          </div>
          <WalletButton compact />
        </header>

        {view.phase === "loading" && (
          <div className="mt-8 space-y-3" aria-busy="true" aria-label="Loading portfolio">
            {[0, 1, 2].map((index) => <div key={index} className="h-24 animate-pulse rounded-[24px] border border-white/[0.06] bg-white/[0.02]" />)}
          </div>
        )}

        {view.phase === "disconnected" && (
          <section className="glass mt-10 rounded-[28px] p-7 text-center sm:p-10">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.06] text-violet-200"><Wallet size={20} /></span>
            <h2 className="mt-5 text-xl font-semibold">Connect a wallet first</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#a8a3b3]">
              Your EVM wallet is your Cabi identity. Connect and sign in - it is free, needs no gas, and sends no transaction - and I can show what you hold.
            </p>
            <button onClick={wallet.openConnect} className="focus-ring mt-6 h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#0b0912]">Connect Wallet</button>
          </section>
        )}

        {view.phase === "error" && (
          <section className="glass mt-10 rounded-[28px] p-7 text-center sm:p-10">
            <h2 className="text-xl font-semibold">I couldn&apos;t read your wallet</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#a8a3b3]">{view.message}</p>
            <button onClick={() => void load({ fresh: true })} className="focus-ring mt-6 inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 text-sm font-semibold"><RefreshCw size={15} /> Try again</button>
          </section>
        )}

        {view.phase === "ready" && (
          <div className="mt-8 space-y-4">
            <section className="glass rounded-[26px] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Connected wallet</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-[#ddd6fe]" title={view.snapshot.address}>{shortAddress(view.snapshot.address, 10, 8)}</span>
                    <button onClick={() => void copy(view.snapshot.address)} className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[#8e889b] hover:bg-white/[0.05] hover:text-white" aria-label="Copy wallet address">
                      {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[#777180]">{view.snapshot.chainName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => void load({ fresh: true })} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
                    <RefreshCw size={13} /> Refresh
                  </button>
                  {view.snapshot.explorerUrl && (
                    <a href={view.snapshot.explorerUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
                      Explorer <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
              <p className="mt-4 text-[10px] text-[#5f5a67]">
                {view.stale ? "Cached a moment ago" : "Read just now"} ? {new Date(view.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            </section>

            {view.snapshot.native && (
              <section className="glass rounded-[26px] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Native balance</p>
                <p className="mt-3 text-3xl font-semibold tracking-[-.03em]">{view.snapshot.native.formatted} <span className="text-lg text-[#a8a3b3]">{view.snapshot.native.symbol}</span></p>
              </section>
            )}

            <section className="glass rounded-[26px] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Tokens</p>
              {view.snapshot.tokens.length === 0 ? (
                <p className="mt-3 text-sm leading-7 text-[#8e889b]">
                  Nothing tracked on {view.snapshot.chainName}. Cabi only reads tokens the owner has configured, so this is not a full scan of your wallet.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {view.snapshot.tokens.map((token) => (
                    <li key={token.address} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{token.name} <span className="text-[#a8a3b3]">${token.symbol}</span></p>
                        <p className="mt-1 break-all font-mono text-[10px] text-[#6f6a7d]">{shortAddress(token.address, 8, 6)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-semibold">{token.formatted}</p>
                        {token.verifiedUrl && (
                          <a href={token.verifiedUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-200 px-3 text-[11px] font-semibold text-[#160f27]">
                            Clank.trade <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="px-1 text-[11px] leading-5 text-[#625d6d]">
              Quantities only. Cabi has no verified price feed, so she will not show a USD value, market cap, or any figure she cannot source. Balances are public onchain data read through the network the owner configured.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}