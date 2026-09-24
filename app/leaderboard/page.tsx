import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Trophy } from "lucide-react";

import { LeaderboardExperience } from "@/components/leaderboard/leaderboard-experience";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { getAppAccess } from "@/lib/site/guard";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard - Cabi",
  description: "Weekly and monthly rankings for Cabi. Earned by real conversations, never by holding tokens.",
};

/**
 * Public leaderboard.
 *
 * Application route, so outside LIVE it renders the prelaunch page rather than
 * an empty board. Reads the wallet session only to mark the caller's own row.
 */
export default async function LeaderboardPage() {
  // Closed until this feature ships. Checked before the site mode so the route
  // is locked in every mode, including LIVE.
  const flags = await readFeatureFlags();
  if (!flags.leaderboard_enabled) return <LockedFeatureScreen flagKey="leaderboard_enabled" />;

  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();

  let wallet = null;
  try { wallet = await readWalletAuth(); } catch { wallet = null; }

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] text-[var(--cabi-text-secondary)] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em] sm:text-2xl">
              <Trophy size={20} className="text-[var(--cabi-primary)]" aria-hidden="true" />
              Leaderboard
            </h1>
            <p className="mt-1 text-xs text-[var(--cabi-text-secondary)]">
              Earned by meaningful activity. Resets weekly and monthly; history is kept.
            </p>
          </div>
        </header>

        <LeaderboardExperience wallet={{ authenticated: Boolean(wallet) }} />
      </div>
    </main>
  );
}