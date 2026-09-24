"use client";

import { Brain, Heart, MessageCircleMore, Sparkles, WalletCards } from "lucide-react";

const features = [
  {
    key: "chat",
    icon: MessageCircleMore,
    title: "Chat with Cabi",
    body: "Talk naturally with your Cat Partner Unit.",
  },
  {
    key: "memory",
    icon: Brain,
    title: "Memory",
    body: "Let Cabi remember your chats when your wallet is connected.",
  },
  {
    key: "wallet",
    icon: WalletCards,
    title: "Wallet",
    body: "Use your EVM wallet as your Cabi identity.",
  },
  {
    key: "clank",
    icon: Sparkles,
    title: "Clank.trade awareness",
    body: "Learn about Clank.trade and open the exact owner-verified $CPU page after launch.",
  },
] as const;

/**
 * Compact feature preview: four small glass chips, not full-width SaaS cards.
 * The chips themselves are plain text so they stay legible at 320px.
 */
export function FeaturePreview({ chips }: { chips: string[] }) {
  return (
    <section aria-labelledby="feature-preview-title" className="glass rounded-2xl p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Heart size={15} className="text-[var(--cabi-primary)]" fill="currentColor" aria-hidden="true" />
          <h2 id="feature-preview-title" className="text-[11px] font-semibold uppercase tracking-[.22em] text-[var(--cabi-primary)]">
            Coming with Cabi
          </h2>
        </div>
        <ul className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-2.5 py-1 text-[11px] font-medium text-[var(--cabi-text-secondary)]"
            >
              {chip}
            </li>
          ))}
          <li className="rounded-full border border-violet-200/[0.16] bg-violet-300/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--cabi-text-secondary)]">
            Coming soon
          </li>
        </ul>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {features.map(({ key, icon: Icon, title, body }) => (
          <article
            key={key}
            data-feature={key}
            className="group rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-4 transition hover:border-violet-200/[0.16] hover:bg-violet-300/[0.04]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-violet-200/[0.12] bg-violet-300/[0.06] text-[var(--cabi-primary)]">
              <Icon size={16} aria-hidden="true" />
            </span>
            <h3 className="mt-3.5 text-[13px] font-semibold uppercase tracking-[.09em] text-white">{title}</h3>
            <p className="mt-2 text-[12px] leading-5 text-[var(--cabi-text-muted)]">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
