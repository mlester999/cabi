import { Award, Crown, Heart, Image, Leaf, Sparkles, Star } from "lucide-react";

const icons = { award: Award, star: Star, sparkles: Sparkles, crown: Crown, heart: Heart, image: Image, leaf: Leaf } as const;
const colors = {
  violet: "border-violet-200/[0.15] bg-violet-300/[0.07] text-violet-100",
  teal: "border-teal-200/[0.15] bg-teal-300/[0.07] text-teal-100",
  amber: "border-amber-200/[0.15] bg-amber-300/[0.07] text-amber-100",
  rose: "border-rose-200/[0.15] bg-rose-300/[0.07] text-rose-100",
  blue: "border-blue-200/[0.15] bg-blue-300/[0.07] text-blue-100",
} as const;

export function ProfileBadgeChip({ badge, compact = false }: {
  badge: { label: string; icon: string; color: string };
  compact?: boolean;
}) {
  const Icon = icons[badge.icon as keyof typeof icons] ?? Award;
  const color = colors[badge.color as keyof typeof colors] ?? colors.violet;
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold ${compact ? "h-6 px-2 text-[9px]" : "min-h-8 px-3 text-[11px]"} ${color}`} title={badge.label}><Icon size={compact ? 11 : 13} aria-hidden="true" /><span className="truncate">{badge.label}</span></span>;
}
