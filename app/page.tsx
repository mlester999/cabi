import { CabiExperience } from "@/components/cabi/cabi-experience";
import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { getAppAccess } from "@/lib/site/guard";
import { getSiteMode } from "@/lib/site/mode";
import { getPrelaunchSettings } from "@/lib/site/prelaunch";
import { getPublicWalletConfig } from "@/lib/wallet/config";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/` is the site-mode switch.
 *
 * - LIVE: the real Cabi application, exactly as before.
 * - PRELAUNCH / MAINTENANCE: the animated prelaunch experience for everyone,
 *   including a signed-in admin (so the owner always sees the public page).
 *   The complete application stays reachable at `/preview`.
 *
 * The decision is made on the server, so an unfinished route is never shipped
 * to a normal visitor's browser in the first place.
 */
export default async function Home() {
  const [access, settings, wallet, { mode }] = await Promise.all([
    getAppAccess(),
    getPrelaunchSettings(),
    getPublicWalletConfig(),
    getSiteMode(),
  ]);

  if (access.live) return <CabiExperience />;
  // Maintenance is a distinct internal state with its own short notice; the
  // application itself is still reachable by an admin through /preview.
  if (mode === "MAINTENANCE") redirect("/maintenance");
  return <PrelaunchExperience settings={settings} wallet={wallet} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const [{ mode }, settings] = await Promise.all([getSiteMode(), getPrelaunchSettings()]);
  const description = mode === "LIVE"
    ? "Meet Cabi, your Cat Partner Unit. Chat, build memories, connect your wallet and explore a new kind of digital companion."
    : `${settings.headline} ${settings.subheadline}`;

  return {
    title: mode === "LIVE" ? "Cabi — Cat Partner Unit" : `${settings.headline} · Cabi`,
    description,
    alternates: { canonical: "/" },
    openGraph: { title: `Cabi — Cat Partner Unit`, description },
    // A prelaunch page is a real, finished public page: it stays indexable so
    // the project can be found and shared before the application opens.
    robots: { index: true, follow: true },
  };
}
