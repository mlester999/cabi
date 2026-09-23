import { CpuExperience } from "@/components/cpu/cpu-experience";
import { getAppAccess } from "@/lib/site/guard";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * `$CPU` has its own launch state, independent of the application, so this page
 * stays reachable in every site mode. `CpuTokenCard` itself only publishes a
 * contract address and buy link once the owner has marked CPU live and supplied
 * both a validated address and the exact Clank.trade coin URL; otherwise it
 * states plainly that nothing is published yet.
 */
export default async function CpuPage() {
  const access = await getAppAccess();
  return <CpuExperience prelaunch={!access.live} />;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "$CPU — Cat Partner Unit",
    description: "Official launch information for Cat Partner Unit ($CPU).",
    alternates: { canonical: "/cpu" },
  };
}
