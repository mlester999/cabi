import Link from "next/link";
import { ArrowUpRight, Gift, Image, Medal, Trophy, BriefcaseBusiness, Camera } from "lucide-react";

const surfaces = [
  { href: "/leaderboard", title: "Leaderboard", description: "See weekly, monthly, and lifetime rankings.", Icon: Trophy },
  { href: "/achievements", title: "Achievements", description: "View permanent milestones earned through Cabi activity.", Icon: Medal },
  { href: "/contest", title: "Image contest", description: "See contest details and submit a saved Cabi image when entries are open.", Icon: Image },
  { href: "/images", title: "Images", description: "Review recent images, favorites, and contest entries.", Icon: Camera },
  { href: "/portfolio", title: "Portfolio", description: "Read balances for your connected wallet on Cabi’s configured network.", Icon: BriefcaseBusiness },
  { href: "/rewards", title: "Rewards", description: "Track leaderboard rewards recorded by the Cabi team.", Icon: Gift },
] as const;

export function ExploreCabiLinks() {
  return <nav className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Explore Cabi surfaces">
    {surfaces.map(({ href, title, description, Icon }) => <Link key={href} href={href} className="group focus-ring rounded-[22px] border border-white/[0.07] bg-white/[0.025] p-5 transition hover:border-violet-200/[0.18] hover:bg-violet-300/[0.045]">
      <span className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-200/[0.12] bg-violet-300/[0.06] text-violet-100"><Icon size={17} aria-hidden="true" /></span><ArrowUpRight size={15} className="text-[#625d6d] transition group-hover:text-violet-100" aria-hidden="true" /></span>
      <span className="mt-4 block text-sm font-semibold text-white">{title}</span>
      <span className="mt-1.5 block text-xs leading-5 text-[#8e889b]">{description}</span>
    </Link>)}
  </nav>;
}
