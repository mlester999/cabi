import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { getPrelaunchSettings } from "@/lib/site/prelaunch";
import { getPublicWalletConfig } from "@/lib/wallet/config";

/**
 * Renders the public prelaunch experience for an application route.
 *
 * `/`, `/settings`, `/portfolio`, and `/cabi` are all part of the application, so
 * they share one behaviour while the site is not LIVE: show the public page
 * rather than a locked-down shell. Centralising it here keeps a new gated route
 * from accidentally inventing its own fallback.
 */
export async function renderPrelaunchFallback() {
  const [settings, wallet] = await Promise.all([getPrelaunchSettings(), getPublicWalletConfig()]);
  return <PrelaunchExperience settings={settings} wallet={wallet} />;
}