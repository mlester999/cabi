import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CabiExperience } from "@/components/cabi/cabi-experience";
import { CabiProfileExperience } from "@/components/cabi/profile/cabi-profile-experience";
import { CpuExperience } from "@/components/cpu/cpu-experience";
import { GalleryExperience } from "@/components/gallery/gallery-experience";
import { LeaderboardExperience } from "@/components/leaderboard/leaderboard-experience";
import { LockedFeatureScreen } from "@/components/features/locked-feature-screen";
import { PortfolioExperience } from "@/components/portfolio/portfolio-experience";
import { PreviewApplication } from "@/components/prelaunch/preview-application";
import { ProfileExperience } from "@/components/profile/profile-experience";
import { MemoryPanel } from "@/components/settings/memory-panel";
import { readFeatureFlags } from "@/lib/config/feature-flags.server";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cabi preview", robots: { index: false, follow: false, nocache: true } };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="cabi-noise min-h-[100dvh] bg-[#07070d] px-4 py-6 text-white sm:px-7"><div className="mx-auto max-w-[1100px]"><header className="flex items-center gap-3"><Link href="/preview" className="focus-ring grid h-11 w-11 place-items-center rounded-xl border border-white/[0.07]" aria-label="Back to Cabi"><ArrowLeft size={18} /></Link><h1 className="text-xl font-semibold">{title}</h1></header>{children}</div></main>;
}

/** Reuses the real application components behind the same preview boundary. */
export default async function PreviewSubpage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  const supported = ["chat", "profile", "settings/memory", "gallery", "portfolio", "leaderboard", "cpu", "cabi"];
  if (!supported.includes(route)) notFound();

  const flags = await readFeatureFlags();
  let content: React.ReactNode;
  switch (route) {
    case "chat": content = <CabiExperience flags={flags} />; break;
    case "profile": {
      const wallet = await readWalletAuth().catch(() => null);
      content = <Section title="Your profile">{wallet ? <ProfileExperience /> : <p className="mt-8 text-sm text-[#a8a3b3]">Connect your wallet to see your profile.</p>}</Section>;
      break;
    }
    case "settings/memory": content = <MemoryPanel />; break;
    case "gallery": content = flags.gallery_enabled ? <Section title="Your gallery"><GalleryExperience /></Section> : <LockedFeatureScreen flagKey="gallery_enabled" />; break;
    case "portfolio": content = flags.portfolio_enabled ? <PortfolioExperience /> : <LockedFeatureScreen flagKey="portfolio_enabled" />; break;
    case "leaderboard": content = flags.leaderboard_enabled ? <Section title="Leaderboard"><LeaderboardExperience wallet={{ authenticated: Boolean(await readWalletAuth().catch(() => null)) }} /></Section> : <LockedFeatureScreen flagKey="leaderboard_enabled" />; break;
    case "cpu": content = <CpuExperience />; break;
    case "cabi": content = <CabiProfileExperience />; break;
    default: notFound();
  }
  return <PreviewApplication>{content}</PreviewApplication>;
}
