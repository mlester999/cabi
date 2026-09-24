"use client";

import type { BrowserWallet } from "@/lib/wallet/client";
import { useState } from "react";

export function WalletLogo({ wallet, size = "md" }: { wallet?: Pick<BrowserWallet, "name" | "icon"> | null; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const label = wallet?.name?.trim() || "Wallet";
  const initials = label.replace(/[^a-z0-9]/giu, "").slice(0, 2).toUpperCase() || "W";
  const dimensions = size === "sm" ? "h-8 w-8 rounded-xl text-[10px]" : "h-9 w-10 rounded-2xl text-xs";

  return (
    <span aria-hidden="true" className={`relative grid shrink-0 place-items-center overflow-hidden border border-violet-200/15 bg-violet-300/[0.08] font-bold tracking-[-.04em] text-[var(--cabi-text-secondary)] ${dimensions}`}>
      <span>{initials}</span>
      {wallet?.icon && !failed && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={wallet.icon}
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-contain p-1"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
