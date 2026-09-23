"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Trash2, UserRound } from "lucide-react";

type Generation = { id: string; prompt: string; aspectRatio: string; model: string | null; createdAt: string; url: string };

/**
 * The signed-in user's generated Cabi images.
 *
 * Only the user's own prompt is shown; the internal character specification is
 * never stored on the row. Images come from short-lived signed URLs, so a copied
 * link stops working rather than exposing a private generation.
 */
export function GalleryExperience() {
  const [images, setImages] = useState<Generation[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/gallery", { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      const payload = await response.json() as { images?: Generation[] };
      setImages(payload.images ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Adopts a generated Cabi image as the profile picture. */
  const adoptAsAvatar = async (id: string) => {
    setBusy(`avatar:${id}`);
    setAvatarNotice(null);
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: id }),
      });
      if (response.ok) {
        setAvatarNotice(id);
        window.setTimeout(() => setAvatarNotice(null), 2_500);
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch("/api/gallery", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (response.ok) setImages((current) => current.filter((image) => image.id !== id));
    } finally {
      setBusy(null);
    }
  };

  if (phase === "loading") return <p className="mt-10 text-center text-sm text-[#a8a3b3]" role="status">Loading your images...</p>;

  if (phase === "error") {
    return (
      <div className="glass mt-10 rounded-[26px] p-8 text-center">
        <p className="text-sm text-[#d5d0de]">I could not load your gallery just now.</p>
        <button type="button" onClick={() => void load()} className="focus-ring mt-5 inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold">Try again</button>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="glass mt-10 rounded-[26px] p-8 text-center">
        <p className="text-sm font-semibold text-white">No images yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-[#a8a3b3]">
          Ask me for a picture in chat, like &ldquo;make an image of you drinking coffee&rdquo;, and it will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((image) => (
        <li key={image.id} className="glass overflow-hidden rounded-[22px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs are short-lived and not routable through next/image. */}
          <img src={image.url} alt={image.prompt} className="aspect-square w-full bg-black/40 object-cover" loading="lazy" />
          <div className="p-4">
            <p className="line-clamp-2 text-[13px] leading-6 text-white">{image.prompt}</p>
            <p className="mt-1.5 text-[11px] text-[#625d6d]">
              {image.aspectRatio} - {new Date(image.createdAt).toLocaleDateString()}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <a
                href={image.url}
                download={`cabi-${image.id}.png`}
                className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
              >
                <Download size={12} aria-hidden="true" /> Download
              </a>
              <button
                type="button"
                onClick={() => void remove(image.id)}
                disabled={busy === image.id}
                className="focus-ring grid h-9 w-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#8e889b] hover:text-rose-200 disabled:opacity-40"
                aria-label={`Delete image: ${image.prompt}`}
              >
                <Trash2 size={13} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* Re-asks with the same scene through the normal chat path, so it
                  is subject to the same daily allowance as any other request. */}
              <button
                type="button"
                onClick={() => router.push(`/?regenerate=${encodeURIComponent(image.prompt)}`)}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]"
              >
                <RefreshCw size={12} aria-hidden="true" /> Regenerate
              </button>
              <button
                type="button"
                onClick={() => void adoptAsAvatar(image.id)}
                disabled={busy === `avatar:${image.id}`}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-200/[0.2] bg-violet-300/[0.08] px-3 text-[11px] font-semibold text-violet-100 hover:bg-violet-300/[0.14] disabled:opacity-40"
              >
                <UserRound size={12} aria-hidden="true" /> Use as picture
              </button>
              {avatarNotice === image.id ? <span role="status" className="text-[11px] text-emerald-200">Saved.</span> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}