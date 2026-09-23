import { PortfolioExperience } from "@/components/portfolio/portfolio-experience";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { getAppAccess } from "@/lib/site/guard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "What your connected wallet holds on the network Cabi is configured for.",
  robots: { index: false, follow: false },
};

/**
 * `/portfolio` is part of the application, so it follows the site mode exactly
 * like `/` and `/settings`: outside LIVE it shows the public prelaunch page
 * instead of exposing an unfinished surface.
 */
export default async function PortfolioPage() {
  // Closed until this feature ships. Checked before the site mode so the route
  // is locked in every mode, including LIVE.
  const flags = await readFeatureFlags();
  if (!flags.portfolio_enabled) return <LockedFeatureScreen flagKey="portfolio_enabled" />;

  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();
  return <PortfolioExperience />;
}