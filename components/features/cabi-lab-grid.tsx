"use client";

import {
  Award,
  Bot,
  Brain,
  BriefcaseBusiness,
  Cpu,
  Gift,
  Image,
  Images,
  Medal,
  MessageCircle,
  Sparkles,
  Trophy,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { LockedFeatureCard } from "@/components/features/locked-feature";
import type { CabiFeatureDefinition, FeatureFlagKey } from "@/lib/config/feature-flags";

type LabFeature = CabiFeatureDefinition & { flag: FeatureFlagKey; enabled: boolean };

const icons: Record<string, LucideIcon> = {
  award: Award,
  brain: Brain,
  bot: Bot,
  "briefcase-business": BriefcaseBusiness,
  cpu: Cpu,
  gift: Gift,
  image: Image,
  images: Images,
  medal: Medal,
  "message-circle": MessageCircle,
  sparkles: Sparkles,
  trophy: Trophy,
  "user-round": UserRound,
  "wallet-cards": WalletCards,
};

function FeatureIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = icons[name] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}

function LiveFeatureCard({ feature }: { feature: LabFeature }) {
  return (
    <article className="cabi-lab-live group relative overflow-hidden rounded-[24px] border border-emerald-200/[0.12] bg-emerald-200/[0.035] p-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-emerald-300/[0.08] blur-3xl" />
      <div className="relative flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-200/[0.15] bg-emerald-200/[0.06] text-emerald-100">
          <FeatureIcon name={feature.icon} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-white">{feature.label}</h3>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" /> Live
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-[#a8a3b3]">{feature.description}</p>
        </div>
      </div>
    </article>
  );
}

/**
 * The Lab's only interactive behavior is an informational note on locked
 * cards. No card navigates into unfinished product surfaces.
 */
export function CabiLabGrid({ features }: { features: ReadonlyArray<LabFeature> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Cabi roadmap features">
      {features.map((feature) => feature.enabled ? (
        <LiveFeatureCard key={feature.id} feature={feature} />
      ) : (
        <LockedFeatureCard
          key={feature.id}
          flagKey={feature.flag}
          icon={<FeatureIcon name={feature.icon} />}
        />
      ))}
    </div>
  );
}
