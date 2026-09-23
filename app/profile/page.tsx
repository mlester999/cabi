import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProfileExperience } from "@/components/profile/profile-experience";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { getAppAccess } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile - Cabi",
  // A personal progression page is not for search engines.
  robots: { index: false, follow: false },
};

/** `/profile` is part of the application, so it follows the site mode. */
export default async function ProfilePage() {
  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();
  const auth = await walletAuthOrResponse();

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">Your profile</h1>
            <p className="mt-1 text-xs text-[#a8a3b3]">Rank, lifetime progress, and your bond with Cabi.</p>
          </div>
        </header>

        {auth.identity ? <ProfileExperience /> : (
          <div className="glass mt-10 rounded-[26px] p-8 text-center">
            <p className="text-sm font-semibold text-white">Connect your wallet first.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[#a8a3b3]">
              Your profile, rank and season history live with your wallet, so I need you signed in to show them.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}