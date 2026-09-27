import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

import { CabiLabGrid } from "@/components/features/cabi-lab-grid";
import { ExploreCabiLinks } from "@/components/features/explore-cabi-links";
import { cabiRoadmapFeatures, roadmapFeatureCount } from "@/lib/config/feature-flags";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore Cabi — Cat Partner Unit",
  description: "Explore Cabi's live community, image, portfolio, and reward surfaces.",
  robots: { index: false, follow: false },
};

/**
 * An index for existing product surfaces, with an honest roadmap below it.
 */
export default function CabiLabPage() {
  const roadmap = cabiRoadmapFeatures.map((feature) => ({
    ...feature,
    flag: feature.flag!,
  }));

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-7 sm:py-10">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200"><Compass size={13} /> Explore Cabi</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Explore Cabi</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#a8a3b3]">A home for your Cabi community, creations, and progress.</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#777180]">Open a live surface below, or see what is still taking shape.</p>
          </div>
        </header>

        <section className="mt-9" aria-labelledby="explore-heading">
          <h2 id="explore-heading" className="text-sm font-semibold">Your Cabi spaces</h2>
          <ExploreCabiLinks />
        </section>

        <section className="mt-10" aria-labelledby="lab-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="lab-heading" className="text-sm font-semibold">In the works</h2>
              <p className="mt-1 text-xs text-[#706a7d]">Unfinished work stays here until it is ready to use.</p>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#625d6d]">{roadmapFeatureCount} features</span>
          </div>

          {roadmap.length ? (
            <div className="mt-5">
              <CabiLabGrid features={roadmap} />
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-sm text-[#a8a3b3]">The lab is quiet for now. Cabi is focused on making the core experience lovely.</p>
          )}
        </section>
      </div>
    </main>
  );
}
