import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Images } from "lucide-react";

import { GalleryExperience } from "@/components/gallery/gallery-experience";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { getAppAccess } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gallery - Cabi",
  robots: { index: false, follow: false },
};

/** `/gallery` is part of the application, so it follows the site mode. */
export default async function GalleryPage() {
  // Closed until this feature ships. Checked before the site mode so the route
  // is locked in every mode, including LIVE.
  const flags = await readFeatureFlags();
  if (!flags.gallery_enabled) return <LockedFeatureScreen flagKey="gallery_enabled" />;

  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();
  const auth = await walletAuthOrResponse();

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] text-[var(--cabi-text-secondary)] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em] sm:text-2xl">
              <Images size={20} className="text-[var(--cabi-primary)]" aria-hidden="true" />
              Cabi images
            </h1>
            <p className="mt-1 text-xs text-[var(--cabi-text-secondary)]">Everything you have asked me to draw. Private to your wallet.</p>
          </div>
        </header>

        {auth.identity ? <GalleryExperience /> : (
          <div className="glass mt-10 rounded-2xl p-8 text-center">
            <p className="text-sm font-semibold text-white">Connect your wallet first.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[var(--cabi-text-secondary)]">
              Generated images are saved to your wallet so only you can see them.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}