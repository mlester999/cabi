"use client";

import { Eye, EyeOff, Gauge, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type PreviewChromeMode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";

const modeCopy: Record<PreviewChromeMode, string> = {
  PRELAUNCH: "Cabi is still in PRELAUNCH for public users.",
  LIVE: "The site is already live — this is the public application.",
  MAINTENANCE: "Maintenance is on. Only you can see this.",
};

/**
 * Sticky reminder + exit control for the private preview.
 *
 * It is rendered only by the server-gated preview application boundary.
 */
export function PreviewBanner({ mode, actor }: { mode: PreviewChromeMode; actor: { kind: "admin" | "wallet"; label: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const exit = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/preview/exit", { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not exit preview. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-[80] border-b border-amber-300/15 bg-[#12100a]/92 backdrop-blur-xl">
      <div className="mx-auto flex min-h-12 w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-amber-200">
          <Eye size={14} aria-hidden="true" /> Preview mode
        </span>
        <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#a8a3b3]">
          {modeCopy[mode]} <span className="hidden sm:inline">Signed in as {actor.label}.</span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="focus-ring flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-semibold text-[#d5d0de] transition hover:bg-white/[0.06]"
          >
            <Gauge size={13} aria-hidden="true" /> Admin
          </Link>
          <Link
            href="/"
            className="focus-ring flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-semibold text-[#d5d0de] transition hover:bg-white/[0.06]"
          >
            <EyeOff size={13} aria-hidden="true" /> View Public Site
          </Link>
          <button
            type="button"
            onClick={() => void exit()}
            disabled={busy}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 text-[11px] font-semibold text-[#251805] transition hover:bg-amber-50 disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : <LogOut size={13} />} Exit preview
          </button>
        </div>
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-rose-200 sm:px-6">{error}</p>}
      <p className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 pb-2 text-[10px] leading-4 text-[#777180] sm:px-6">
        <ShieldCheck size={12} className="shrink-0 text-amber-200/80" aria-hidden="true" />
        Wallet sign-in, saved chats, memories, and the bond system use your real account here. Public visitors remain on the prelaunch page.
      </p>
    </div>
  );
}
