import { MemoryPanel } from "@/components/settings/memory-panel";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { cpuGatedPage } from "@/lib/cpu-access/page";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Memory",
  description: "See and manage what Cabi remembers about you.",
  robots: { index: false, follow: false },
};

/** Memory is part of the application, so it follows the site mode and the gate. */
export default async function MemoryPage() {
  const gated = await cpuGatedPage(() => <MemoryPanel />);
  if (gated.allowed || gated.gated) return <>{gated.element}</>;
  return renderPrelaunchFallback();
}
