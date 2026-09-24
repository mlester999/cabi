import { CabiExperience } from "@/components/cabi/cabi-experience";
import { PreviewApplication } from "@/components/prelaunch/preview-application";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cabi preview",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Private preview of the complete Cabi application.
 *
 * This is the one place the unfinished application can be exercised while the
 * public site is in PRELAUNCH or MAINTENANCE. Authorization is enforced on the
 * server, in this order:
 *
 * An existing admin session with preview opt-in, or a verified allowlisted
 * owner wallet with a matching preview credential, may open this route.
 *
 * A normal visitor is redirected to `/` before any application code is
 * rendered, and the gated application APIs repeat the same check themselves.
 */
export default async function PreviewPage() {
  return <PreviewApplication><CabiExperience flags={await readFeatureFlags()} viewport="preview" /></PreviewApplication>;
}
