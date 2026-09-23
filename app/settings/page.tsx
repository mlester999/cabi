import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { SettingsExperience } from "@/components/settings/settings-experience";
import { getAppAccess } from "@/lib/site/guard";
import { getPrelaunchSettings } from "@/lib/site/prelaunch";
import { getPublicWalletConfig } from "@/lib/wallet/config";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * `/settings` is a real application route, so it follows the site mode just
 * like `/`. In PRELAUNCH or MAINTENANCE it shows the public prelaunch page
 * rather than leaking per-user settings screens; `/preview/settings` is where
 * an admin tests the real thing.
 */
export default async function SettingsPage() {
  const access = await getAppAccess();
  if (access.live) return <SettingsExperience />;

  const [settings, wallet] = await Promise.all([getPrelaunchSettings(), getPublicWalletConfig()]);
  return <PrelaunchExperience settings={settings} wallet={wallet} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const access = await getAppAccess();
  if (access.live) {
    return { title: "Settings", description: "Make Cabi feel right for you." };
  }
  return { title: "Settings", robots: { index: false, follow: true } };
}
