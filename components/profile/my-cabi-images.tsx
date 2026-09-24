"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";

type Item = {
  id: string;
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  url: string | null;
  parentGenerationId: string | null;
};

type Quota = { used: number; dailyLimit: number; remaining: number } | null;

/**
 * My Cabi Images.
 *
 * A small authenticated list, not a gallery: the Gallery stays in the works. It
 * reuses the same generation rows and storage objects the chat does, so an image
 * deleted here is gone from the conversation too, and vice versa.
 *
 * Regenerate hands the scene back to the chat composer rather than running a
 * second, hidden generation path — the request then goes through the same chat,
 * quota and safety checks as any other.
 */
export function MyCabiImages() {
  const [images, setImages] = useState<Item[]>([]);
  const [quota, setQuota] = useState<Quota>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/profile/images", { cache: "no-store" });
      if (!response.ok) { setPhase("error"); return; }
      const payload = await response.json() as { images?: Item[]; quota?: Quota };
      setImages(payload.images ?? []);
      setQuota(payload.quota ?? null);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const remove = async (id: string) => {
    setBusy(id);
    setNotice("");
    try {
      const response = await fetch("/api/profile/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) { setNotice("I couldn't remove that one."); return; }
      // Removed locally as well as server-side, so the list never shows a stale
      // entry whose object is already gone.
      setImages((current) => current.filter((image) => image.id !== id));
      setNotice("Removed.");
    } finally {
      setBusy(null);
    }
  };

  if (phase === "loading") return <p className="mt-4 text-sm text-[#a8a3b3]" role="status">Loading your Cabi images...</p>;

  if (phase === "error") {
    return (
      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-center">
        <p className="text-sm text-[#d5d0de]">I couldn&apos;t load your images just now.</p>
        <button type="button" onClick={() => void load()} className="focus-ring mt-3 inline-flex h-9 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-semibold">Try again</button>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-center">
        <p className="text-sm font-semibold text-white">No Cabi images yet.</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-6 text-[#a8a3b3]">
          Ask me in chat, like &ldquo;make a picture of you drinking coffee&rdquo;, and it will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {notice ? <p role="status" className="mb-3 text-[11px] text-violet-200">{notice}</p> : null}
      {quota ? (
        <p className="mb-3 text-[10px] text-[#777180]">
          Cabi Images <span className="text-[#a8a3b3]">{quota.used} / {quota.dailyLimit}</span> used today
        </p>
      ) : null}
      {quota ? <p className="mb-3 text-[11px] text-[#706a7d]">{quota.remaining} image{quota.remaining === 1 ? "" : "s"} left today</p> : null}
      <ul className="grid gap-3 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.id} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
            {image.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs.
              <img src={image.url} alt={image.prompt} className="aspect-square w-full bg-black/40 object-cover" loading="lazy" />
            ) : null}
            <div className="p-2.5">
              <p className="line-clamp-2 text-[11px] leading-5 text-[#d5d0de]">{image.prompt}</p>
              <p className="mt-1 text-[10px] text-[#625d6d]">{new Date(image.createdAt).toLocaleDateString()}</p>
              <div className="mt-2 flex items-center gap-1.5">
                <a
                  href={image.url ?? "#"}
                  download={`cabi-${image.id}.png`}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8e889b] hover:text-white"
                  aria-label={`Download image: ${image.prompt}`}
                >
                  <Download size={12} />
                </a>
                {/* Prefills the composer, so the re-run uses the normal chat path,
                    safety checks and daily allowance rather than a hidden path. */}
                <a
                  href={`/?regenerate=${encodeURIComponent(image.prompt)}`}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8e889b] hover:text-white"
                  aria-label={`Regenerate image: ${image.prompt}`}
                >
                  <RefreshCw size={12} />
                </a>
                <button
                  type="button"
                  onClick={() => void remove(image.id)}
                  disabled={busy === image.id}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8e889b] hover:text-rose-200 disabled:opacity-40"
                  aria-label={`Delete image: ${image.prompt}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
