"use client";

import Image from "next/image";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { CabiActivityStatus } from "@/components/cabi/cabi-activity-status";
import { cabiFailureMessages } from "@/lib/cabi/status-messages";
import type { ImageCard } from "@/lib/actions/types";

/** A generated image preview inside the transcript. */
export function ImageCardView({ card, status }: {
  card: ImageCard;
  status?: "QUEUED" | "GENERATING" | "COMPLETED" | "FAILED";
}) {
  const aspectParts = /^(\d{1,2}):(\d{1,2})$/u.exec(card.aspectRatio);
  const ratioWidth = aspectParts ? Number(aspectParts[1]) : 1;
  const ratioHeight = aspectParts ? Number(aspectParts[2]) : 1;
  const scale = 1024 / Math.max(ratioWidth, ratioHeight);
  const imageWidth = Math.max(1, Math.round(ratioWidth * scale));
  const imageHeight = Math.max(1, Math.round(ratioHeight * scale));

  return (
    <figure
      aria-label="Generated image preview"
      className="mt-3 overflow-hidden rounded-2xl border border-violet-200/[0.10] bg-white/[0.02]"
    >
      {status === "QUEUED" || status === "GENERATING" ? (
        <div className="grid aspect-square w-full place-items-center bg-gradient-to-br from-violet-500/[0.08] to-transparent p-6 text-center">
          <div className="w-full max-w-[16rem]">
            <MiniCabi className="cabi-breathe mx-auto h-20 w-20 rounded-[26px]" decorative />
            <CabiActivityStatus type="IMAGE_GENERATING" className="mt-4 justify-center" mascot={false} />
          </div>
        </div>
      ) : status === "FAILED" ? (
        <div className="grid aspect-square w-full place-items-center bg-black/40 p-6 text-center">
          <p className="text-[13px] font-semibold text-[#d5d0de]">{cabiFailureMessages.IMAGE}</p>
        </div>
      ) : card.url ? (
        <div className="bg-black/20">
          <Image
            src={card.url}
            alt="Generated Cabi image"
            width={imageWidth}
            height={imageHeight}
            unoptimized
            loading="eager"
            decoding="async"
            className="mx-auto block max-h-[70vh] w-full object-contain"
          />
        </div>
      ) : null}
    </figure>
  );
}
