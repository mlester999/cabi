"use client";

import { Download, RefreshCw, Share2, Sparkles, Trash2, UserRound } from "lucide-react";
import { MiniCabi } from "@/components/cabi/mini-cabi";
import { CabiActivityStatus } from "@/components/cabi/cabi-activity-status";
import { cabiFailureMessages, cabiRetryLabel } from "@/lib/cabi/status-messages";
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
export function ImageCardView({ card, onRegenerate, onUseAsAvatar, status, onRetry, onDelete, onShare }: {
  card: ImageCard;
  onRegenerate?: (prompt: string) => void;
  onUseAsAvatar?: (card: ImageCard) => void;
  /**
   * Lifecycle state, when the caller knows it. A card whose generation is still
   * running or has failed must not render as a broken image: it renders as its
   * state, with a retry where one makes sense.
   */
  status?: "QUEUED" | "GENERATING" | "COMPLETED" | "FAILED";
  onRetry?: (prompt: string) => void;
  onDelete?: () => void;
  /** Opens the existing chat share card for this reply. */
  onShare?: () => void;
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
      {status === "QUEUED" || status === "GENERATING" ? (
        /* An intentional loading state: Cabi's own rotating lines rather than a
           spinner, escalated on elapsed time by the shared component. */
        <div className="grid aspect-square w-full place-items-center bg-gradient-to-br from-violet-500/[0.08] to-transparent p-6 text-center">
          <div className="w-full max-w-[16rem]">
            <MiniCabi className="cabi-breathe mx-auto h-20 w-20 rounded-[26px]" decorative />
            <CabiActivityStatus type="IMAGE_GENERATING" className="mt-4 justify-center" mascot={false} />
            <p className="mt-1 text-[11px] text-[#777180]">This usually takes a few seconds.</p>
          </div>
        </div>
      ) : status === "FAILED" ? (
        <div className="grid aspect-square w-full place-items-center bg-black/40 p-6 text-center">
          <div>
            <p className="text-[13px] font-semibold text-[#d5d0de]">{cabiFailureMessages.IMAGE}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(card.prompt)}
                className="focus-ring mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
              >
                <RefreshCw size={12} aria-hidden="true" /> {cabiRetryLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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

          {/* Share reuses the existing chat share card, so branding stays in one place. */}
          {card.url && onShare ? (
            <button
              type="button"
              onClick={onShare}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
            >
              <Share2 size={12} aria-hidden="true" /> Share
            </button>
          ) : null}

          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="focus-ring grid h-9 w-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#8e889b] hover:text-rose-200"
              aria-label={`Delete image: ${card.prompt}`}
            >
              <Trash2 size={13} />
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