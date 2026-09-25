"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import type { RankTier } from "@/lib/ranking/tiers";

/**
 * Shareable progression card.
 *
 * Drawn on a canvas in the browser: the lifetime rank, XP, and weekly
 * placing, branded as Cabi. A wallet address is never drawn, so a shared card
 * cannot leak one even if the user crops it badly.
 *
 * Sized 1:1 (1080x1080) per the brief.
 */
export type RankCardInput = {
  username: string;
  tier: RankTier;
  lifetimeXp: number;
  weeklyPlacement: number | null;
};

export function drawRankCard(input: RankCardInput): string | null {
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#07070d");
  gradient.addColorStop(0.6, "#120d20");
  gradient.addColorStop(1, "#251442");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  // Tier-tinted glow so the card reads as Elite or Legend at a glance.
  const glow = context.createRadialGradient(size / 2, size * 0.34, 0, size / 2, size * 0.34, size * 0.62);
  glow.addColorStop(0, `${input.tier.accent}44`);
  glow.addColorStop(1, "transparent");
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);

  context.strokeStyle = "rgba(196,181,253,.22)";
  context.lineWidth = 3;
  context.strokeRect(46, 46, size - 92, size - 92);

  // Brand line.
  context.fillStyle = "#c4b5fd";
  context.font = "700 30px system-ui";
  context.fillText("CABI  -  CAT PARTNER UNIT", 100, 135);

  // Handle, truncated so a long name cannot run off the card.
  context.fillStyle = "#ffffff";
  context.font = "800 76px system-ui";
  const handle = input.username.length > 18 ? `${input.username.slice(0, 17)}...` : input.username;
  context.fillText(handle, 100, 300);

  // Tier, in the tier's own accent.
  context.fillStyle = input.tier.accent;
  context.font = "800 112px system-ui";
  context.fillText(input.tier.label.toUpperCase(), 100, 460);

  // Lifetime XP is what earned this rank.
  context.fillStyle = "#ffffff";
  context.font = "700 64px system-ui";
  context.fillText(`${input.lifetimeXp.toLocaleString()} Lifetime XP`, 100, 600);

  if (input.weeklyPlacement) {
    context.fillStyle = "#c4b5fd";
    context.font = "700 44px system-ui";
    context.fillText(`#${input.weeklyPlacement} this week`, 100, 760);
  }

  context.fillStyle = "#777180";
  context.font = "500 28px system-ui";
  context.fillText("Rank is earned by meaningful Cabi activity", 100, size - 150);
  context.fillText("never by holding tokens", 100, size - 108);

  return canvas.toDataURL("image/png");
}

/** Download button for the progression card. */
export function ShareRankCard({ input, className = "" }: { input: RankCardInput; className?: string }) {
  const [busy, setBusy] = useState(false);

  const download = () => {
    setBusy(true);
    try {
      const url = drawRankCard(input);
      if (!url) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = `cabi-${input.username}-${input.tier.key.toLowerCase()}.png`;
      link.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className={`focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold text-[#d5d0de] hover:bg-white/[0.06] disabled:opacity-40 ${className}`}
    >
      <Download size={14} aria-hidden="true" /> Share rank card
    </button>
  );
}
