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

      <section className="glass relative z-20 w-full max-w-[540px] rounded-[30px] p-7 sm:p-9">
        <span className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 rounded-full bg-violet-400/20 blur-2xl" aria-hidden="true" />
          <CabiMascot className="relative h-14 w-14" />
        </span>
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.26em] text-violet-300">Admin only</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Open the live preview</h1>
        <p className="mt-3 text-sm leading-7 text-[#a8a3b3]">
          Preview opens the complete Cabi application for your admin session only. Public visitors keep seeing the
          {" "}{mode === "MAINTENANCE" ? "maintenance notice" : "prelaunch page"}.
        </p>

        <dl className="mt-6 space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[#777180]">Website mode</dt>
            <dd className="font-semibold text-violet-100">{mode}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[#777180]">Source</dt>
            <dd className="text-[#a8a3b3]">{override ? "Environment override" : source === "database" ? "Saved in dashboard" : "Default"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-5 text-[#777180]">{siteModeDescriptions[mode]}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <PreviewStartButton />
          <Link
            href="/"
            className="focus-ring inline-flex h-11 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-semibold text-[#d5d0de] transition hover:bg-white/[0.06]"
          >
            View public page
          </Link>
        </div>

        <p className="mt-6 text-[11px] leading-5 text-[#625d6d]">
          Preview lasts 4 hours and can be ended at any time from the banner at the top of the application or from the
          admin console.
        </p>
      </section>
    </main>
  );
}
