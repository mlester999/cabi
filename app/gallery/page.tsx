import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Images - Cabi", robots: { index: false, follow: false } };

/** Keep the old collection URL working while /images is the canonical route. */
export default async function GalleryAliasPage() {
  const flags = await readFeatureFlags();
  if (!flags.gallery_enabled) return <LockedFeatureScreen flagKey="gallery_enabled" />;

  const gated = await cpuGatedPage(() => null);
  if (!gated.allowed && !gated.gated) return renderPrelaunchFallback();
  if (gated.gated) return <>{gated.element}</>;

  redirect("/images");
}
