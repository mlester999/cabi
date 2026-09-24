import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProfileExperience } from "@/components/profile/profile-experience";
import { CpuGateBypassNotice } from "@/components/cpu/cpu-gate-bypass-notice";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile - Cabi",
  // A personal progression page is not for search engines.
  robots: { index: false, follow: false },
};

/**
 * `/profile` is part of the application, so it follows the site mode and the
 * $CPU holder gate. `cpuGatedPage` renders the holder gate instead of the page
 * when the wallet does not qualify, so progression data is never sent.
 */
export default async function ProfilePage() {
  const gated = await cpuGatedPage(() => null);
  if (!gated.allowed && !gated.gated) return renderPrelaunchFallback();
  if (gated.gated) return <>{gated.element}</>;
  const [auth, flags] = await Promise.all([walletAuthOrResponse(), readFeatureFlags()]);

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">Your profile</h1>
            <p className="mt-1 text-xs text-[#a8a3b3]">
              {flags.ranking_enabled ? "Rank, lifetime progress, and your bond with Cabi." : "Your identity, bond, and saved moments with Cabi."}
            </p>
          </div>
        </header>
        {gated.bypassed && <div className="mt-5"><CpuGateBypassNotice /></div>}

        {auth.identity ? <ProfileExperience rankingEnabled={flags.ranking_enabled} achievementsEnabled={flags.achievements_enabled} /> : (
          <div className="glass mt-10 rounded-[26px] p-8 text-center">
            <p className="text-sm font-semibold text-white">Connect your wallet first.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[#a8a3b3]">
              {flags.ranking_enabled
                ? "Your profile, rank and season history live with your wallet, so I need you signed in to show them."
                : "Your profile and bond live with your wallet, so I need you signed in to show them."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
