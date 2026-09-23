"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import { MiniCabi } from "@/components/cabi/mini-cabi";
import { ArrowUpRight, X } from "lucide-react";

/**
 * Prelaunch top bar: CABI · $CPU · X.
 *
 * There is intentionally no link into `/chat` while the site is in prelaunch —
 * the only interactive control is the optional wallet sign-in, which unlocks
 * saved chats once Cabi opens.
 */
export function PrelaunchHeader({
  ticker,
  xUrl,
  communityUrl,
  showSocial,
}: {
  ticker: string;
  xUrl: string;
  communityUrl: string;
  showSocial: boolean;
}) {
  return (
    <header className="relative z-30 mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-5 pt-5 sm:px-8 sm:pt-7">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-violet-200/[0.13] bg-violet-300/[0.05]">
          <MiniCabi className="h-[30px] w-[30px] rounded-[10px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold leading-none tracking-[.16em] text-white">CABI</span>
          <span className="mt-1 block truncate text-[9px] uppercase tracking-[.22em] text-[#625d6d]">Cat Partner Unit</span>
        </span>
      </div>

      <nav aria-label="Prelaunch links" className="flex items-center gap-2">
        <a
          href="#cpu"
          className="focus-ring hidden rounded-xl px-3 py-2 text-xs font-semibold tracking-[.08em] text-[#a8a3b3] transition hover:bg-white/[0.04] hover:text-white sm:block"
        >
          ${ticker}
        </a>
        {showSocial && xUrl && (
          <a
            href={xUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Cabi on X"
            className="focus-ring grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-[#a8a3b3] transition hover:border-violet-200/20 hover:text-white"
          >
            <X size={15} />
          </a>
        )}
        {showSocial && communityUrl && (
          <a
            href={communityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring hidden h-9 items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-xs font-semibold text-[#a8a3b3] transition hover:border-violet-200/20 hover:text-white sm:flex"
          >
            Community <ArrowUpRight size={13} />
          </a>
        )}
        <span className="hidden sm:block"><WalletButton compact /></span>
      </nav>
    </header>
  );
}
