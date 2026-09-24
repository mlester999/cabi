"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explorerAddressUrl, shortenAddress } from "@/lib/wallet/client";
import { useWallet } from "@/components/wallet/wallet-provider";
import { WalletLogo } from "@/components/wallet/wallet-logo";
import { Check, Copy, ExternalLink, LogOut, Network } from "lucide-react";
import { useState } from "react";

/**
 * The wallet chip.
 *
 * One chip, one job: it shows the connected address and opens a menu. Before this
 * pass the header carried a wallet chip *plus* a separate padding of tiny status
 * indicators around it; those are gone, and the only status shown is a single dot
 * whose colour means connected or wrong-network.
 *
 * The address is truncated with a middle ellipsis rather than an end ellipsis, so
 * the leading and trailing characters a person actually recognises both stay
 * visible.
 */
export function WalletButton({ compact = false, requiredChainId = null }: { compact?: boolean; requiredChainId?: number | null }) {
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);

  if (!wallet.sessionLoaded) {
    return <span className={`cabi-skeleton ${compact ? "h-9 w-24" : "h-9 w-32"}`} aria-label="Loading wallet session" />;
  }

  if (!wallet.authenticated || !wallet.address) {
    return (
      <button
        onClick={wallet.openConnect}
        className={`cabi-btn cabi-btn-primary cabi-focus ${compact ? "cabi-btn-sm" : "cabi-btn-md"}`}
      >
        <WalletLogo wallet={null} size="sm" />
        <span>{compact ? "Connect" : "Connect Wallet"}</span>
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
        <button
          className={`cabi-btn cabi-focus ${compact ? "cabi-btn-sm" : "cabi-btn-md"} ${
            wrongNetwork ? "cabi-btn-secondary !border-[var(--cabi-warning-border)] text-[var(--cabi-warning)]" : "cabi-btn-secondary"
          }`}
          aria-label={`Wallet ${wallet.address}. Opens the wallet menu.`}
        >
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${wrongNetwork ? "bg-[var(--cabi-warning)]" : "bg-[var(--cabi-success)]"}`} />
          <span className="font-mono text-[12px] tabular-nums">{shortenAddress(wallet.address)}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={10} className="cabi-glass w-[min(336px,calc(100vw-24px))] p-4 text-white">
        <div className="flex items-start gap-3">
          <WalletLogo wallet={wallet.activeWallet} size="md" />
          <div className="min-w-0 flex-1">
            <p className="cabi-overline">Wallet</p>
            <p className="mt-1 truncate font-mono text-[13px] text-white">{wallet.address}</p>
          </div>
        </div>

        <div className={`cabi-inset mt-4 p-3 ${wrongNetwork ? "cabi-surface-warning" : ""}`}>
          <div className="flex items-center gap-2 text-[11px] text-[var(--cabi-text-muted)]">
            <Network size={13} aria-hidden="true" /><span>Network</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{wallet.chainName()}</p>
            {wrongNetwork ? <span className="shrink-0 text-[11px] font-semibold text-[var(--cabi-warning)]">Wrong network</span> : null}
          </div>
          {wrongNetwork ? (
            <button onClick={() => void wallet.switchNetwork(requiredChainId)} className="cabi-btn cabi-btn-sm cabi-btn-primary cabi-focus cabi-btn-block mt-3">
              Switch network
            </button>
          ) : null}
        </div>

        {wallet.error ? <p role="alert" className="cabi-error-text mt-3">{wallet.error}</p> : null}

        <div className="mt-3 grid gap-1">
          <MenuRow onClick={() => void copyAddress()} icon={copied ? <Check size={15} className="text-[var(--cabi-success)]" /> : <Copy size={15} />}>
            {copied ? "Copied" : "Copy address"}
          </MenuRow>
          {explorerUrl ? (
            <MenuRow href={explorerUrl} icon={<ExternalLink size={15} />}>View on explorer</MenuRow>
          ) : null}
          <MenuRow onClick={() => void wallet.disconnect()} icon={<LogOut size={15} />} tone="danger">Disconnect</MenuRow>
        </div>
      </PopoverContent>
    </Popover>
  );
}
/** One row of the wallet menu: same height, same padding, same hover, everywhere. */
function MenuRow({
  children,
  icon,
  onClick,
  href,
  tone = "neutral",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "neutral" | "danger";
}) {
  const classes = `cabi-focus flex h-9 items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors ${
    tone === "danger"
      ? "text-[var(--cabi-text-secondary)] hover:bg-[var(--cabi-danger-surface)] hover:text-[var(--cabi-danger)]"
      : "text-[var(--cabi-text-secondary)] hover:bg-[var(--cabi-surface-2)] hover:text-white"
  }`;
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>{icon}{children}</a>;
  }
  return <button type="button" onClick={onClick} className={classes}>{icon}{children}</button>;
}
