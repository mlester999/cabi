import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";

import { CabiLabGrid } from "@/components/features/cabi-lab-grid";
import { cabiRoadmapFeatures, roadmapFeatureCount } from "@/lib/config/feature-flags";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cabi Lab — Cat Partner Unit",
  description: "Things Cabi is still working on.",
  robots: { index: false, follow: false },
};

/**
 * Future work belongs here, away from the conversation. The cards are honest:
 * they describe what is planned without pretending that an unfinished surface
 * is usable.
 */
export default async function CabiLabPage() {
  const flags = await readFeatureFlags();
  const roadmap = cabiRoadmapFeatures.map((feature) => ({
    ...feature,
    flag: feature.flag!,
    enabled: flags[feature.flag!],
  }));

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-7 sm:py-10">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200"><FlaskConical size={13} /> Cabi Lab</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Cabi Lab</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#a8a3b3]">Things I&apos;m still working on.</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#777180]">The chat stays focused. Future Cabi features live here until they&apos;re ready.</p>
          </div>
        </header>

        <section className="mt-10" aria-labelledby="lab-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="lab-heading" className="text-sm font-semibold">In the works</h2>
              <p className="mt-1 text-xs text-[#706a7d]">A quiet roadmap for the parts that are still taking shape.</p>
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
