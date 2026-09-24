import { MiniCabi } from "@/components/cabi/mini-cabi";
import { CabiMascot } from "@/components/cabi/cabi-mascot";
import { getSiteMode } from "@/lib/site/mode";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cabi is napping",
  description: "Cabi is briefly unavailable while the owner finishes some work.",
  robots: { index: false, follow: false },
};

/**
 * Deliberately short maintenance notice.
 *
 * It reuses the prelaunch visual language instead of a second design system,
 * it never exposes a route into the application, and it only exists while the
 * owner has actually set MAINTENANCE.
 */
export default async function MaintenancePage() {
  const { mode } = await getSiteMode();
  if (mode !== "MAINTENANCE") redirect("/");
  return (
    <div className="cabi-prelaunch cabi-noise relative grid min-h-[100dvh] place-items-center overflow-x-hidden bg-transparent px-5 py-16 text-white">
      <div className="cabi-atmosphere" aria-hidden="true" />
      <div className="cabi-grain" aria-hidden="true" />

      <main className="relative z-20 w-full max-w-[520px] text-center">
        <div className="glass rounded-2xl p-7 sm:p-9">
          <span className="relative mx-auto grid h-20 w-20 place-items-center">
            <span className="cabi-glow absolute inset-0 rounded-full bg-violet-500/20 blur-2xl" aria-hidden="true" />
            <CabiMascot className="relative h-16 w-16" />
          </span>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.26em] text-[var(--cabi-primary)]">Cabi · Cat Partner Unit</p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Cabi is napping.</h1>
          <p className="mx-auto mt-4 max-w-[24rem] text-pretty text-sm leading-7 text-[var(--cabi-text-secondary)]">
            She&apos;s briefly offline while some work is finished. Everything you saved is safe — come back in a little
            while.
          </p>
          <div className="cabi-indeterminate mt-7 h-px w-full rounded-full bg-[var(--cabi-surface-3)]" aria-hidden="true" />
          <Link
            href="/"
            className="focus-ring mx-auto mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--cabi-primary)] px-5 text-sm font-semibold text-[var(--cabi-on-primary)] transition hover:brightness-105"
          >
            <MiniCabi className="h-5 w-5 rounded-lg" decorative /> Try again
          </Link>
        </div>
      </main>
    </div>
  );
}
