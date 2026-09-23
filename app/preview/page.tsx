import { CabiExperience } from "@/components/cabi/cabi-experience";
import { PreviewBanner, type PreviewChromeMode } from "@/components/prelaunch/preview-banner";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode } from "@/lib/site/mode";
import { isPreviewActive } from "@/lib/site/preview";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin preview",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin-only live preview of the complete Cabi application.
 *
 * This is the one place the unfinished application can be exercised while the
 * public site is in PRELAUNCH or MAINTENANCE. Authorization is enforced on the
 * server, in this order:
 *
 * 1. a valid signed admin session, otherwise `/admin/login`;
 * 2. an explicit preview opt-in cookie minted by `POST /api/admin/preview`.
 *
 * A normal visitor is redirected to `/` before any application code is
 * rendered, and the gated application APIs repeat the same check themselves.
 */
export default async function PreviewPage() {
  const session = await readAdminSession();
  if (!session) redirect("/admin/login");
  if (!(await isPreviewActive())) redirect("/preview/start");

  const { mode } = await getSiteMode();
  const chromeMode: PreviewChromeMode = mode === "LIVE" ? "LIVE" : mode === "MAINTENANCE" ? "MAINTENANCE" : "PRELAUNCH";

  return (
    <>
      <PreviewBanner mode={chromeMode} email={session.email} />
      <CabiExperience />
    </>
  );
}
