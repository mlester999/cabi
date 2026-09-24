import { SettingsExperience } from "@/components/settings/settings-experience";
import { PreviewApplication } from "@/components/prelaunch/preview-application";
import type { Metadata } from "next";

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
  return <PreviewApplication><SettingsExperience /></PreviewApplication>;
}
