import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { cabiFeatureForFlag, lockedFeatureCopy, type FeatureFlags } from "@/lib/config/feature-flags";

/**
 * The polished locked screen for a route that is not shipping yet.
 *
 * Used instead of a redirect so a bookmarked or shared link lands somewhere
 * intentional rather than bouncing. It shows no data of any kind: no empty
 * leaderboard, no zeroed portfolio, no placeholder ranks.
 */
export function LockedFeatureScreen({ flagKey }: { flagKey: keyof FeatureFlags }) {
  const definition = cabiFeatureForFlag(flagKey);
  const copy = lockedFeatureCopy[flagKey] ?? (definition ? { title: definition.label, description: definition.description } : undefined);

  return (
    <main className="cabi-noise grid min-h-[100dvh] place-items-center bg-transparent px-4 text-white">
      <div className="w-full max-w-[440px] text-center">
        <div className="relative mx-auto h-24 w-24">
          <div aria-hidden="true" className="absolute inset-0 rounded-[30px] bg-violet-400/15 blur-2xl" />
          <MiniCabi className="relative h-24 w-24 rounded-[30px]" />
        </div>

        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-violet-200/[0.14] bg-violet-200/[0.05] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200">
          <Lock size={11} aria-hidden="true" /> In the works
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-[-0.03em]">{copy?.title ?? "This one"}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[#a8a3b3]">
          {copy?.description ?? "Cabi is still building this"} — I am working on it, but it is not ready yet.
          I would rather show you nothing than something half-finished.
        </p>

        <Link
          href="/"
          className="focus-ring mt-7 inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-[#0b0912] shadow-[0_12px_40px_rgba(255,255,255,.1)] hover:bg-violet-100"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to Cabi
        </Link>

        <p className="mt-4 text-[11px] text-[#625d6d]">Chat, Cabi images, memory and your profile are all live.</p>
      </div>
    </main>
  );
}
