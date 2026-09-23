"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explorerAddressUrl, shortenAddress } from "@/lib/wallet/client";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Check, Copy, ExternalLink, LogOut, Network, WalletCards } from "lucide-react";
import { useState } from "react";

export function WalletButton({ compact = false, requiredChainId = null }: { compact?: boolean; requiredChainId?: number | null }) {
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);

  if (!wallet.sessionLoaded) {
    return <span className={`${compact ? "h-9 w-24" : "h-10 w-32"} animate-pulse rounded-xl bg-white/[0.05]`} aria-label="Loading wallet session" />;
  }

  if (!wallet.authenticated || !wallet.address) {
    return (
      <button onClick={wallet.openConnect} className={`focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-white font-semibold text-[#0b0912] shadow-[0_8px_26px_rgba(255,255,255,.08)] transition hover:bg-violet-100 ${compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"}`}>
        <WalletCards size={compact ? 14 : 16} />
        <span className={compact ? "max-sm:hidden" : ""}>Connect Wallet</span>
        {compact && <span className="sm:hidden">Connect</span>}
      </button>
    );
  }

  const currentChain = wallet.config.chains.find((chain) => chain.id === wallet.chainId && chain.enabled);
  const explorerUrl = explorerAddressUrl(currentChain, wallet.address);
  const wrongNetwork = wallet.isWrongNetwork(requiredChainId);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`focus-ring inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition ${wrongNetwork ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100" : "border-violet-200/[0.14] bg-violet-300/[0.05] text-violet-100 hover:bg-violet-300/[0.09]"} ${compact ? "h-9 px-3 text-xs" : "h-10 px-3.5 text-sm"}`}>
          <span className={`h-2 w-2 rounded-full ${wrongNetwork ? "bg-amber-300" : "bg-emerald-300"}`} />
          {shortenAddress(wallet.address)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="glass w-[min(336px,calc(100vw-24px))] rounded-[22px] border-violet-200/[0.12] bg-[#0d0b15] p-4 text-white shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.07] text-violet-200"><WalletCards size={18} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs text-[#777180]">Wallet</p><p className="mt-1 truncate font-mono text-sm text-[#ede9fe]">{wallet.address}</p></div>
        </div>

        <div className={`mt-4 rounded-2xl border p-3 ${wrongNetwork ? "border-amber-300/15 bg-amber-300/[0.04]" : "border-white/[0.06] bg-white/[0.025]"}`}>
          <div className="flex items-center gap-2 text-xs text-[#777180]"><Network size={13} /><span>Network</span></div>
          <div className="mt-1.5 flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{wallet.chainName()}</p>{wrongNetwork && <span className="shrink-0 text-[11px] font-semibold text-amber-200">Wrong network</span>}</div>
          {wrongNetwork && <button onClick={() => void wallet.switchNetwork(requiredChainId)} className="focus-ring mt-3 flex h-9 w-full items-center justify-center rounded-xl bg-amber-100 text-xs font-semibold text-[#251805] hover:bg-amber-50">Switch Network</button>}
        </div>

        {wallet.error && <p role="alert" className="mt-3 text-xs leading-5 text-rose-200">{wallet.error}</p>}

        <div className="mt-3 grid gap-1">
          <button onClick={() => void copyAddress()} className="focus-ring flex h-10 items-center gap-3 rounded-xl px-3 text-left text-sm text-[#a8a3b3] hover:bg-white/[0.04] hover:text-white">
            {copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={15} />} {copied ? "Copied" : "Copy address"}
          </button>
          {explorerUrl && <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="focus-ring flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-[#a8a3b3] hover:bg-white/[0.04] hover:text-white"><ExternalLink size={15} /> View on explorer</a>}
          <button onClick={() => void wallet.disconnect()} className="focus-ring flex h-10 items-center gap-3 rounded-xl px-3 text-left text-sm text-[#a8a3b3] hover:bg-rose-300/[0.05] hover:text-rose-200"><LogOut size={15} /> Disconnect</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
