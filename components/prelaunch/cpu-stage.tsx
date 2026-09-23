"use client";

import { explorerAddressUrl } from "@/lib/wallet/client";
import { fallbackCpuDescription } from "@/lib/wallet/public-defaults";
import { ArrowUpRight, Check, Clock3, Copy, Network, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { PublicWalletConfig } from "@/lib/wallet/config";

/**
 * $CPU on the prelaunch page.
 *
 * The token and the application have independent launch states, so the token
 * block can be complete while the application itself is still PRELAUNCH.
 *
 * The values come from the same owner-managed configuration every other $CPU
 * surface uses, which is already redacted by `redactUnlaunchedCpu`: while the
 * admin record is not LIVE, the contract, network, and trade URL arrive empty and
 * this block states plainly that nothing is published. No contract address is
 * hardcoded here, so an unverified token destination can never be presented as
 * official. Network-specific wallet controls stay gated until the admin record
 * has a verified enabled chain.
 */
export function CupStage({ settings, wallet }: { settings: { cpuStatus: "PRELAUNCH" | "LIVE" }; wallet: PublicWalletConfig }) {
  const [copied, setCopied] = useState(false);
  const cpu = wallet.cpu;
  const description = cpu.description.trim() || fallbackCpuDescription;
  const contractAddress = cpu.contractAddress;
  const clankTradeUrl = cpu.clankTradeUrl;
  const chain = cpu.chainId == null ? undefined : wallet.chains.find((candidate) => candidate.id === cpu.chainId && candidate.enabled);
  const published = Boolean(contractAddress && clankTradeUrl);
  const live = settings.cpuStatus === "LIVE" && cpu.launchStatus === "LIVE" && Boolean(contractAddress && chain && clankTradeUrl);
  const explorerUrl = live && contractAddress && chain
    ? cpu.explorerUrl || explorerAddressUrl(chain, contractAddress)
    : null;

  const copyContract = async () => {
    if (!contractAddress) return;
    try {
      await navigator.clipboard.writeText(contractAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section id="cpu" aria-labelledby="cpu-stage-title" className="glass scroll-mt-24 rounded-[28px] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-300">Cat Partner Unit</p>
          <h2 id="cpu-stage-title" className="mt-2 text-3xl font-semibold tracking-[-.045em]">
            ${cpu.ticker || "CPU"}
          </h2>
        </div>
        {live ? (
          <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-200">
            Live
          </span>
        ) : published ? (
          <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-200">
            Published
          </span>
        ) : (
          <span className="rounded-full border border-violet-200/[0.14] bg-violet-300/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-violet-200">
            Coming soon
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(13rem,.7fr)]">
        <div className="rounded-[22px] border border-violet-200/[0.10] bg-violet-300/[0.035] p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200/80">About ${cpu.ticker || "CPU"}</p>
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#b9b3c6] sm:text-sm sm:leading-7">{description}</p>
        </div>
        <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#706a7d]">Cabi system</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-violet-200/[0.12] bg-violet-300/[0.06] px-2.5 py-1 text-[10px] font-medium text-violet-100">Companion project</span>
            <span className="rounded-full border border-emerald-300/[0.12] bg-emerald-300/[0.05] px-2.5 py-1 text-[10px] font-medium text-emerald-100">Prelaunch mode</span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#777180]">Official token details are published by the owner.</p>
        </div>
      </div>

      {live && contractAddress && chain ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.025] p-4 sm:col-span-2">
            <p className="text-[10px] uppercase tracking-[.16em] text-[#706a7d]">Contract</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <a
                href={explorerUrl ?? undefined}
                target={explorerUrl ? "_blank" : undefined}
                rel={explorerUrl ? "noopener noreferrer" : undefined}
                className="focus-ring min-w-0 truncate rounded-lg font-mono text-xs text-[#ddd6fe] hover:text-white"
                title={contractAddress}
              >
                {contractAddress}
              </a>
              <button
                type="button"
                onClick={() => void copyContract()}
                className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#8e889b] transition hover:bg-white/[0.05] hover:text-white"
                aria-label="Copy $CPU contract address"
              >
                {copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={15} />}
              </button>
            </div>
            <p role="status" className="mt-1 min-h-[14px] text-[10px] text-emerald-300">{copied ? "Copied" : ""}</p>
          </div>

          <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.025] p-4">
            <p className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-[#706a7d]">
              <Network size={12} aria-hidden="true" /> Network
            </p>
            <p className="mt-2 text-sm font-medium">{chain.name}</p>
          </div>

          {clankTradeUrl ? (
            <a
              href={clankTradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring flex h-full min-h-[74px] items-center justify-center gap-2 rounded-[22px] bg-violet-200 px-4 text-sm font-semibold text-[#160f27] transition hover:brightness-105"
            >
              Buy ${cpu.ticker} <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          ) : (
            <p className="rounded-[22px] border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] leading-5 text-[#8e889b]">
              Trading links appear once the owner publishes the verified Clank.trade coin page.
            </p>
          )}
        </div>
      ) : published ? (
        <div className="mt-6 space-y-3">
          <div className="rounded-[22px] border border-emerald-300/15 bg-emerald-300/[0.04] p-4">
            <p className="text-[10px] uppercase tracking-[.16em] text-emerald-200/80">Official contract</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-xs text-[#ddd6fe]" title={contractAddress}>{contractAddress}</span>
              <button
                type="button"
                onClick={() => void copyContract()}
                className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#8e889b] transition hover:bg-white/[0.05] hover:text-white"
                aria-label="Copy $CPU contract address"
              >
                {copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={15} />}
              </button>
            </div>
            <p role="status" className="mt-1 min-h-[14px] text-[10px] text-emerald-300">{copied ? "Copied" : ""}</p>
          </div>
          <a
            href={clankTradeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[22px] bg-violet-200 px-4 text-sm font-semibold text-[#160f27] transition hover:brightness-105"
          >
            View $CPU on Clank.trade <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="mt-6 flex items-start gap-3 rounded-[22px] border border-white/[0.06] bg-white/[0.02] p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-200">
            <Clock3 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Coming Soon</p>
            <p className="mt-1.5 text-[12px] leading-5 text-[#8e889b]">
              The official ${cpu.ticker || "CPU"} contract and Clank.trade link appear here only after the owner verifies
              and publishes them.
            </p>
          </div>
        </div>
      )}

      <p className="mt-5 flex items-start gap-2.5 text-[11px] leading-5 text-[#777180]">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
        {published ? "The contract and Clank.trade page above are owner-provided. No price or market data is shown here. " : "No contract address, price, market data, or buy link is invented before launch. "}
        Cabi never asks for a seed phrase or private key.
      </p>
    </section>
  );
}
