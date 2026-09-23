"use client";

import { useWallet } from "@/components/wallet/wallet-provider";
import { explorerAddressUrl, shortenAddress } from "@/lib/wallet/client";
import { Check, Clock3, Copy, ExternalLink, Network, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function CpuTokenCard({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);
  const cpu = wallet.config.cpu;
  const chain = cpu.chainId == null ? undefined : wallet.config.chains.find((candidate) => candidate.id === cpu.chainId && candidate.enabled);
  const live = cpu.launchStatus === "LIVE" && Boolean(cpu.contractAddress && chain);
  const explorerUrl = live && cpu.contractAddress ? (cpu.explorerUrl || explorerAddressUrl(chain, cpu.contractAddress)) : null;
  const wrongNetwork = Boolean(live && cpu.chainId && wallet.authenticated && wallet.chainId && wallet.isWrongNetwork(cpu.chainId));

  const copyContract = async () => {
    if (!live || !cpu.contractAddress) return;
    try {
      await navigator.clipboard.writeText(cpu.contractAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  if (!wallet.configLoaded) {
    // The site is seeded into PRELAUNCH, so the loading state says what is
    // almost always true and resolves to the real card a moment later.
    return (
      <div className={`glass animate-pulse rounded-[28px] ${compact ? "p-4" : "p-6 sm:p-8"}`} aria-busy="true" aria-label="Loading CPU information">
        <div className={`grid place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-200 ${compact ? "h-10 w-10" : "h-12 w-12"}`}><Clock3 size={compact ? 18 : 21} /></div>
        <p className={`font-semibold ${compact ? "mt-4 text-base" : "mt-5 text-2xl"}`}>Coming Soon</p>
        <p className={`leading-6 text-[#8e889b] ${compact ? "mt-2 text-xs" : "mt-3 text-sm"}`}>Checking the published $CPU details…</p>
      </div>
    );
  }

  if (!live) {
    return (
      <div className={`glass rounded-[28px] ${compact ? "p-4" : "p-6 sm:p-8"}`}>
        <div className={`grid place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-200 ${compact ? "h-10 w-10" : "h-12 w-12"}`}><Clock3 size={compact ? 18 : 21} /></div>
        <p className={`font-semibold ${compact ? "mt-4 text-base" : "mt-5 text-2xl"}`}>Coming Soon</p>
        <p className={`leading-6 text-[#8e889b] ${compact ? "mt-2 text-xs" : "mt-3 text-sm"}`}>Official $CPU contract and trade details will appear here only after they are verified and published by the owner.</p>
        {!compact && <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-[#777180]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-300" /> No contract address, price, market data, or buy link is shown before launch.</div>}
      </div>
    );
  }

  return (
    <div className={`glass rounded-[28px] ${compact ? "p-4" : "p-6 sm:p-7"}`}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Cat Partner Unit</p><h2 className={`${compact ? "mt-1 text-xl" : "mt-2 text-3xl"} font-semibold tracking-[-.04em]`}>${cpu.ticker}</h2></div>
        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-200">Live</span>
      </div>

      <div className="mt-5 space-y-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
          <p className="text-[10px] uppercase tracking-[.14em] text-[#706a7d]">Contract</p>
          <div className="mt-2 flex items-center justify-between gap-3"><span className="min-w-0 truncate font-mono text-xs text-[#ddd6fe]" title={cpu.contractAddress}>{compact ? shortenAddress(cpu.contractAddress) : cpu.contractAddress}</span><button onClick={() => void copyContract()} className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#8e889b] hover:bg-white/[0.05] hover:text-white" aria-label="Copy CPU contract address">{copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={15} />}</button></div>
          {copied && <p role="status" className="mt-1 text-[10px] text-emerald-300">Copied</p>}
        </div>
        <div className={`rounded-2xl border p-3 ${wrongNetwork ? "border-amber-300/15 bg-amber-300/[0.04]" : "border-white/[0.06] bg-white/[0.025]"}`}>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.14em] text-[#706a7d]"><Network size={12} /> Network</div>
          <div className="mt-1.5 flex items-center justify-between gap-2"><p className="text-sm font-medium">{chain?.name}</p>{wrongNetwork && <span className="text-[10px] font-semibold text-amber-200">Wrong network</span>}</div>
          {wrongNetwork && <button onClick={() => void wallet.switchNetwork(cpu.chainId)} className="focus-ring mt-3 h-9 w-full rounded-xl bg-amber-100 text-xs font-semibold text-[#251805]">Switch Network</button>}
        </div>
      </div>

      {cpu.clankTradeUrl && <a href={cpu.clankTradeUrl} target="_blank" rel="noopener noreferrer" className="focus-ring mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-200 text-sm font-semibold text-[#160f27] hover:brightness-105">Buy ${cpu.ticker} <ExternalLink size={14} /></a>}
      {!compact && <div className="mt-2 grid gap-2 sm:grid-cols-2">{cpu.clankTradeUrl && <a href={cpu.clankTradeUrl} target="_blank" rel="noopener noreferrer" className="focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs font-semibold hover:bg-white/[0.06]">View on Clank.trade <ExternalLink size={13} /></a>}{explorerUrl && <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs font-semibold hover:bg-white/[0.06]">View Contract <ExternalLink size={13} /></a>}</div>}
      {compact && explorerUrl && <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="focus-ring mt-2 flex h-9 items-center justify-center gap-2 rounded-xl text-xs text-[#a8a3b3] hover:bg-white/[0.035] hover:text-white">View contract <ExternalLink size={12} /></a>}
    </div>
  );
}
