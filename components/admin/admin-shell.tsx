"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import {
  Activity, Bot, Brain, Coins, DatabaseZap, Eye, FileText, Flag, Gauge,
  ImagePlus, LogOut, MessageSquareText, Palette, Settings, ShieldCheck, Trophy, UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * The admin console shell.
 *
 * The navigation was a flat list of fifteen links, which reads as a raw settings
 * dump rather than a product control panel. It is now four named groups — Core,
 * AI, Product, System — so an operator can find a screen by what it is *for*
 * rather than by scanning alphabetically.
 *
 * The group label is hidden in the collapsed rail below `lg`, because a 76px rail
 * has no room for it and the icons carry a `title` tooltip instead.
 */
const navigationGroups = [
  {
    label: "Core",
    links: [
      ["/admin", "Dashboard", Gauge],
      ["/admin/users", "Users", UsersRound],
      ["/admin/conversations", "Conversations", MessageSquareText],
      ["/admin/memories", "Memories", FileText],
    ],
  },
  {
    label: "AI",
    links: [
      ["/admin/ai", "Chat AI", Bot],
      ["/admin/images", "Image Generation", ImagePlus],
      ["/admin/personality", "Personality", Brain],
    ],
  },
  {
    label: "Product",
    links: [
      ["/admin/cpu", "$CPU", Coins],
      ["/admin/flags", "Feature Flags", Flag],
      ["/admin/branding", "Branding", Palette],
      ["/admin/ranking", "Ranking", Trophy],
    ],
  },
  {
    label: "System",
    links: [
      ["/admin/knowledge", "Knowledge", DatabaseZap],
      ["/admin/settings", "Settings", Settings],
      ["/admin/audit", "Audit", ShieldCheck],
    ],
  },
] as const;

export function AdminShell({ children, email }: { children: React.ReactNode; email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  };

  const isActive = (href: string) => (href === "/admin" ? pathname === href : pathname.startsWith(href));

  return (
    <main className="cabi-page min-h-[100dvh]">
      <div className="grid min-h-[100dvh] grid-cols-[252px_minmax(0,1fr)] max-lg:grid-cols-[76px_minmax(0,1fr)] max-sm:grid-cols-1">
        <aside className="sticky top-0 flex h-[100dvh] flex-col border-r border-[var(--cabi-hairline)] bg-[var(--cabi-bg-deep)] p-3 max-sm:relative max-sm:h-auto max-sm:flex-row max-sm:items-center max-sm:border-b max-sm:border-r-0">
          <Link href="/" className="cabi-focus flex h-12 shrink-0 items-center gap-3 rounded-lg px-2">
            <MiniCabi className="h-9 w-9" />
            <span className="max-lg:hidden">
              <span className="block text-sm font-bold tracking-[.12em]">CABI</span>
              <span className="cabi-overline block !text-[9px]">Admin console</span>
            </span>
          </Link>

          <nav className="scrollbar-cabi mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto max-sm:ml-3 max-sm:mt-0 max-sm:flex max-sm:gap-1 max-sm:space-y-0 max-sm:overflow-x-auto" aria-label="Admin navigation">
            {navigationGroups.map((group) => (
              <div key={group.label} className="max-sm:contents">
                <p className="cabi-overline px-3 pb-1.5 max-lg:hidden">{group.label}</p>
                <div className="space-y-0.5 max-sm:contents">
                  {group.links.map(([href, label, Icon]) => (
                    <Link
                      key={href}
                      href={href}
                      title={`${group.label} · ${label}`}
                      aria-current={isActive(href) ? "page" : undefined}
                      className={`cabi-focus flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors max-lg:justify-center max-lg:px-0 max-sm:h-11 max-sm:min-w-11 ${
                        isActive(href)
                          ? "bg-[var(--cabi-surface-3)] text-[var(--cabi-primary)]"
                          : "text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-2)] hover:text-white"
                      }`}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span className="max-lg:hidden">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}

            <div className="max-sm:contents">
              <p className="cabi-overline px-3 pb-1.5 max-lg:hidden">Preview</p>
              <Link
                href="/preview"
                title="Preview · Live preview"
                className={`cabi-focus flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors max-lg:justify-center max-lg:px-0 max-sm:h-11 max-sm:min-w-11 ${
                  isActive("/preview")
                    ? "bg-[var(--cabi-surface-3)] text-[var(--cabi-primary)]"
                    : "text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-2)] hover:text-white"
                }`}
              >
                <Eye size={17} aria-hidden="true" />
                <span className="max-lg:hidden">Live preview</span>
              </Link>
            </div>
          </nav>

          <div className="mt-3 shrink-0 border-t border-[var(--cabi-hairline)] pt-3 max-sm:ml-auto max-sm:mt-0 max-sm:border-0 max-sm:pt-0">
            <div className="px-3 py-2 max-lg:hidden">
              <p className="truncate text-xs text-[var(--cabi-text-secondary)]">{email}</p>
              <p className="cabi-caption mt-1 flex items-center gap-1 !text-[10px] !text-[var(--cabi-success)]">
                <Activity size={10} aria-hidden="true" /> Secured
              </p>
            </div>
            <button
              onClick={() => void logout()}
              title="Sign out"
              className="cabi-focus flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-[var(--cabi-text-muted)] transition-colors hover:bg-[var(--cabi-surface-2)] hover:text-white max-lg:justify-center max-lg:px-0"
            >
              <LogOut size={17} aria-hidden="true" />
              <span className="max-lg:hidden">Sign out</span>
            </button>
          </div>
        </aside>

        {/* A consistent content column: every admin page shares this max width and
            padding, so no screen is wider or tighter than its neighbours. */}
        <section className="min-w-0 px-5 py-6 sm:px-7 sm:py-8 lg:px-9 lg:py-10">
          <div className="mx-auto w-full max-w-[1080px]">{children}</div>
        </section>
      </div>
    </main>
  );
}
