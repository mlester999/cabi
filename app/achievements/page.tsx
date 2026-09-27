import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Award } from "lucide-react";

import { AchievementExperience } from "@/components/achievements/achievement-experience";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Achievements - Cabi", robots: { index: false, follow: false } };

export default async function AchievementsPage() {
  const flags = await readFeatureFlags();
  if (!flags.achievements_enabled) return <LockedFeatureScreen flagKey="achievements_enabled" />;
  const gated = await cpuGatedPage(() => null);
  if (!gated.allowed && !gated.gated) return renderPrelaunchFallback();
  if (gated.gated) return <>{gated.element}</>;
  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[900px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi"><ArrowLeft size={18} /></Link>
          <span className="grid h-11 w-11 place-items-center rounded-[15px] bg-violet-300/[0.08] text-violet-200"><Award size={20} /></span>
          <div><h1 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">Achievements</h1><p className="mt-1 text-xs text-[#a8a3b3]">Small moments, kept for good.</p></div>
        </header>
        <AchievementExperience authenticated={Boolean(wallet)} />
      </div>
    </main>
  );
}
