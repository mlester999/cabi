import { PreviewStartButton } from "@/components/admin/preview-start-button";
import { CabiMascot } from "@/components/cabi/cabi-mascot";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode, siteModeDescriptions } from "@/lib/site/mode";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start preview",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Explicit opt-in gate for the admin live preview.
 *
 * Arriving here without an admin session sends the visitor to the admin login;
 * there is no path from the public site into the application.
 */
export default async function PreviewStartPage() {
  const session = await readAdminSession();
  if (!session) redirect("/admin/login");
  const { mode, source, override } = await getSiteMode();

  return (
    <main className="cabi-prelaunch cabi-noise relative grid min-h-[100dvh] place-items-center overflow-x-hidden bg-transparent px-5 py-16 text-white">
      <div className="cabi-atmosphere" aria-hidden="true" />
      <div className="cabi-grain" aria-hidden="true" />

      <section className="glass relative z-20 w-full max-w-[540px] rounded-2xl p-7 sm:p-9">
        <span className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 rounded-full bg-violet-400/20 blur-2xl" aria-hidden="true" />
          <CabiMascot className="relative h-12 w-14" />
        </span>
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.26em] text-[var(--cabi-primary)]">Admin only</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Open the live preview</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--cabi-text-secondary)]">
          Preview opens the complete Cabi application for your admin session only. Public visitors keep seeing the
          {" "}{mode === "MAINTENANCE" ? "maintenance notice" : "prelaunch page"}.
        </p>

        <dl className="mt-6 space-y-2 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--cabi-text-muted)]">Website mode</dt>
            <dd className="font-semibold text-[var(--cabi-text-secondary)]">{mode}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--cabi-text-muted)]">Source</dt>
            <dd className="text-[var(--cabi-text-secondary)]">{override ? "Environment override" : source === "database" ? "Saved in dashboard" : "Default"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-5 text-[var(--cabi-text-muted)]">{siteModeDescriptions[mode]}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PreviewStartButton />
          <Link
            href="/"
            className="focus-ring inline-flex h-11 items-center rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-4 text-sm font-semibold text-[var(--cabi-text-secondary)] transition hover:bg-[var(--cabi-surface-3)]"
          >
            View public page
          </Link>
        </div>

        <p className="mt-6 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
          Preview lasts 4 hours and can be ended at any time from the banner at the top of the application or from the
          admin console.
        </p>
      </section>
    </main>
  );
}
