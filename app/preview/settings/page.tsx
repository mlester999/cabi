import { SettingsExperience } from "@/components/settings/settings-experience";
import { PreviewBanner, type PreviewChromeMode } from "@/components/prelaunch/preview-banner";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode } from "@/lib/site/mode";
import { isPreviewActive } from "@/lib/site/preview";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings preview",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin-only mirror of `/settings`.
 *
 * `/settings` is public and follows the site mode, so the preview cannot use
 * it. This route reuses the exact same component with the preview chrome and
 * the same server-side authorization as `/preview`.
 */
export default async function PreviewSettingsPage() {
  const session = await readAdminSession();
  if (!session) redirect("/admin/login");
  if (!(await isPreviewActive())) redirect("/preview/start");

  const { mode } = await getSiteMode();
  const chromeMode: PreviewChromeMode = mode === "LIVE" ? "LIVE" : mode === "MAINTENANCE" ? "MAINTENANCE" : "PRELAUNCH";

  return (
    <>
      <PreviewBanner mode={chromeMode} email={session.email} />
      <SettingsExperience />
    </>
  );
}
