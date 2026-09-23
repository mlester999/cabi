"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { WalletButton } from "@/components/wallet/wallet-button";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function PublicRouteLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const links = [{ href: "/", label: "Chat" }, { href: "/cpu", label: "$CPU" }];
  return (
    <nav className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`} aria-label="Main navigation">
      {links.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={`focus-ring rounded-lg font-medium transition ${compact ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-sm"} ${active ? "bg-white/[0.05] text-white" : "text-[#8e889b] hover:bg-white/[0.035] hover:text-white"}`}>{link.label}</Link>;
      })}
    </nav>
  );
}

export function PublicHeader({ requiredChainId = null }: { requiredChainId?: number | null }) {
  return (
    <header className="sticky top-0 z-40 flex h-[68px] items-center justify-between border-b border-white/[0.06] bg-[#07070d]/82 px-4 backdrop-blur-xl sm:px-7">
      <div className="flex items-center gap-3 sm:gap-7">
        <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-xl" aria-label="Cabi chat home"><MiniCabi className="h-9 w-9" /><span className="hidden text-sm font-bold tracking-[.12em] text-white sm:block">CABI</span></Link>
        <PublicRouteLinks />
      </div>
      <WalletButton compact requiredChainId={requiredChainId} />
    </header>
  );
}
