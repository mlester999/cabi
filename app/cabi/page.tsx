import { CabiProfileExperience } from "@/components/cabi/profile/cabi-profile-experience";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { getAppAccess } from "@/lib/site/guard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cabi",
  description: "Your Cat Partner Unit: mood, bond, and how long you two have been talking.",
  robots: { index: false, follow: false },
};

/** `/cabi` is part of the application, so it follows the site mode like `/`. */
export default async function CabiPage() {
  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();
  return <CabiProfileExperience />;
}