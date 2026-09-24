"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { WalletButton } from "@/components/wallet/wallet-button";
import Link from "@/components/prelaunch/preview-link";

export function PublicHeader({ active }: { active: "chat" | "cpu" }) {
  return (
    <header className="sticky top-0 z-40 flex h-[70px] items-center justify-between border-b border-[var(--cabi-hairline)] bg-[var(--cabi-bg)]/82 px-4 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-4 sm:gap-7">
        <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-xl" aria-label="Cabi home">
          <MiniCabi className="h-9 w-9" />
          <span className="hidden text-[15px] font-bold tracking-[.1em] sm:block">CABI</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          <Link href="/" aria-current={active === "chat" ? "page" : undefined} className={`focus-ring rounded-xl px-3 py-2 text-sm font-semibold transition ${active === "chat" ? "bg-[var(--cabi-surface-3)] text-white" : "text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-2)] hover:text-white"}`}>Chat</Link>
          <Link href="/cpu" aria-current={active === "cpu" ? "page" : undefined} className={`focus-ring rounded-xl px-3 py-2 text-sm font-semibold transition ${active === "cpu" ? "bg-[var(--cabi-surface-3)] text-white" : "text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-2)] hover:text-white"}`}>$CPU</Link>
        </nav>
      </div>
      <WalletButton compact />
    </header>
  );
}
