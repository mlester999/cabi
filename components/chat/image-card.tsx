"use client";

import { Download, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";

import type { ImageCard } from "@/lib/actions/types";

/**
 * A generated Cabi image inside the transcript.
 *
 * Download is offered, and "use as profile picture" only appears when the user
 * has claimed a username to attach it to. Regenerate re-asks with the same
 * prompt through the normal chat path, so it is subject to the same quota as any
 * other request rather than being a free extra call.
 */
export function ImageCardView({ card, onRegenerate, onUseAsAvatar }: {
  card: ImageCard;
  onRegenerate?: (prompt: string) => void;
  onUseAsAvatar?: (card: ImageCard) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const saveAsAvatar = async () => {
    if (!onUseAsAvatar) return;
    setSaving(true);
    setNotice("");
    try {
      onUseAsAvatar(card);
      setNotice("Saved as your profile picture.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <figure
      aria-label={`Generated image: ${card.prompt}`}
      className="mt-3 overflow-hidden rounded-[22px] border border-violet-200/[0.14] bg-white/[0.02]"
    >
      {card.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed short-lived storage URLs are not routable through next/image.
        <img
          src={card.url}
          alt={`Cabi: ${card.prompt}`}
          className="w-full bg-black/40 object-cover"
          loading="lazy"
          style={{ aspectRatio: card.aspectRatio.replace(":", " / ") }}
        />
      ) : (
        <div className="grid aspect-square w-full place-items-center bg-black/40 p-6 text-center">
          <p className="text-xs text-[#a8a3b3]">This image link has expired. Ask me again and I will redraw it.</p>
        </div>
      )}

      <figcaption className="p-3.5">
        <p className="flex items-center gap-2 text-[12px] text-[#d5d0de]">
          <Sparkles size={12} className="shrink-0 text-violet-300" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{card.prompt}</span>
        </p>

        {card.xp ? <p className="mt-1.5 text-[11px] font-semibold text-violet-200">First image today +{card.xp} XP</p> : null}
        {notice ? <p role="status" className="mt-1.5 text-[11px] text-emerald-200">{notice}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {card.url ? (
            <a
              href={card.url}
              download={`cabi-${card.generationId}.png`}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
            >
              <Download size={12} aria-hidden="true" /> Download
            </a>
          ) : null}

          {onRegenerate ? (
            <button
              type="button"
              onClick={() => onRegenerate(card.prompt)}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
            >
              <RefreshCw size={12} aria-hidden="true" /> Regenerate
            </button>
          ) : null}

          {/* Only offered when the account has a username for it to live on. */}
          {card.canUseAsAvatar && onUseAsAvatar ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAsAvatar()}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-200/[0.2] bg-violet-300/[0.08] px-3 text-[11px] font-semibold text-violet-100 hover:bg-violet-300/[0.14] disabled:opacity-40"
            >
              <UserRound size={12} aria-hidden="true" /> Use as profile picture
            </button>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}