"use client";

import { Award, Bot, Brain, BriefcaseBusiness, Cpu, Gift, Image, Images, Medal, MessageCircle, Sparkles, Trophy, UserRound, WalletCards, type LucideIcon } from "lucide-react";

import { LockedFeatureCard } from "@/components/features/locked-feature";
import type { CabiFeatureDefinition, FeatureFlagKey } from "@/lib/config/feature-flags";

type LabFeature = CabiFeatureDefinition & { flag: FeatureFlagKey };

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

/** These are genuinely unfinished surfaces, so they stay informational even if an owner toggles a flag. */
export function CabiLabGrid({ features }: { features: ReadonlyArray<LabFeature> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Cabi roadmap features">
      {features.map((feature) => (
        <LockedFeatureCard
          key={feature.id}
          flagKey={feature.flag}
          icon={<FeatureIcon name={feature.icon} />}
        />
      ))}
    </div>
  );
}
