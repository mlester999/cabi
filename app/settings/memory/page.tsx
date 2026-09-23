import { MemoryPanel } from "@/components/settings/memory-panel";
import { renderPrelaunchFallback } from "@/components/prelaunch/render-fallback";
import { getAppAccess } from "@/lib/site/guard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Memory",
  description: "See and manage what Cabi remembers about you.",
  robots: { index: false, follow: false },
};

/** Memory is part of the application, so it follows the site mode. */
export default async function MemoryPage() {
  const access = await getAppAccess();
  if (!access.live) return renderPrelaunchFallback();
  return <MemoryPanel />;
}