import { CabiExperience } from "@/components/cabi/cabi-experience";
import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { OwnerPreviewEntry } from "@/components/prelaunch/owner-preview-entry";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { readActiveStatusOverrides } from "@/lib/cabi/status-settings.server";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import { getSiteMode } from "@/lib/site/mode";
import { getPrelaunchSettings } from "@/lib/site/prelaunch";
import { readOwnerPreviewAuth } from "@/lib/site/owner-preview";
import { getPublicWalletConfig } from "@/lib/wallet/config";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/` is the site-mode switch and the Cabi application itself.
 *
 * - PRELAUNCH / MAINTENANCE: the animated prelaunch experience for everyone,
 *   including a signed-in admin (so the owner always sees the public page).
 *   The complete application stays reachable at `/preview`.
 * - LIVE: the application, but only for a wallet that passes the $CPU holder
 *   gate. The decision is made on the server by `cpuGatedPage()`, so the
 *   application markup is never sent to a wallet that does not qualify and
 *   direct navigation cannot skip the gate.
 */
export default async function Home() {
  const [settings, wallet, { mode }, flags] = await Promise.all([
    getPrelaunchSettings(),
    getPublicWalletConfig(),
    getSiteMode(),
    // Resolved on the server and passed down. The browser never decides which
    // features exist.
    readFeatureFlags(),
  ]);
  if (mode !== "LIVE") {
    if (mode === "MAINTENANCE") redirect("/maintenance");
    const ownerPreview = await readOwnerPreviewAuth();
    return <PrelaunchExperience settings={settings} wallet={wallet} preview={ownerPreview ? <OwnerPreviewEntry /> : undefined} />;
  }


  // Owner-added activity lines are read on the server and passed down, so the
  // browser never decides what Cabi says. With nothing configured this is null and
  // the built-in catalogue applies.
  const statusMessages = await readActiveStatusOverrides();
  const gated = await cpuGatedPage((bypassed) => <CabiExperience flags={flags} cpuGateBypassed={bypassed} statusMessages={statusMessages ?? undefined} />);
  if (gated.allowed) return gated.element;
  if (gated.gated) return gated.element;
  // The gate could not resolve a wallet identity at all (a cookie read failure,
  // for example). The safe answer is to treat the visitor as unauthenticated
  // rather than to render the application.
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
