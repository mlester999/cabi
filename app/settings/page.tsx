import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { SettingsExperience } from "@/components/settings/settings-experience";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import { getSiteMode } from "@/lib/site/mode";
import { getPrelaunchSettings } from "@/lib/site/prelaunch";
import { getPublicWalletConfig } from "@/lib/wallet/config";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * `/settings` is a real application route, so it follows the site mode and the
 * $CPU holder gate just like `/`. In PRELAUNCH or MAINTENANCE it shows the
 * public prelaunch page rather than leaking per-user settings screens;
 * `/preview/settings` is where an admin tests the real thing.
 */
export default async function SettingsPage() {
  const gated = await cpuGatedPage(() => <SettingsExperience />);
  if (gated.allowed || gated.gated) return <>{gated.element}</>;

  const [settings, wallet] = await Promise.all([getPrelaunchSettings(), getPublicWalletConfig()]);
  return <PrelaunchExperience settings={settings} wallet={wallet} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const { mode } = await getSiteMode();
  if (mode === "LIVE") {
    return { title: "Settings", description: "Make Cabi feel right for you." };
  }
  return { title: "Settings", robots: { index: false, follow: true } };
}
