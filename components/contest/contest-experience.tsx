"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, ImagePlus, Trophy } from "lucide-react";

type Generation = { id: string; prompt: string; aspectRatio: string; createdAt: string; url: string };
type Entry = { id: string; contestId: string; username: string; submittedAt: string; imageUrl: string };
type Contest = { id: string; title: string; description: string; startsAt: string; endsAt: string; status: string; canSubmit: boolean; ownEntryId: string | null; winnerEntryId: string | null; entries: Entry[] };
type Payload = { contests: Contest[]; myImages: Generation[] };

export function ContestExperience({ authenticated }: { authenticated: boolean }) {
  const [data, setData] = useState<Payload>({ contests: [], myImages: [] });
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/contest", { cache: "no-store" });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "I couldn't load contests.");
      setData(payload);
      setPhase("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "I couldn't load contests.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, load]);

  const submit = async (contestId: string, imageGenerationId: string) => {
    setBusy(`${contestId}:${imageGenerationId}`);
    setNotice("");
    try {
      const response = await fetch("/api/contest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contestId, imageGenerationId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setNotice(payload.error ?? "I couldn't submit that image."); return; }
      setNotice("Your Cabi image is in the contest.");
      await load();
    } catch {
      setNotice("I couldn't submit that image.");
    } finally {
      setBusy(null);
    }
  };

  if (!authenticated) return <section className="glass mt-8 rounded-[26px] p-7 text-center"><ImagePlus className="mx-auto text-violet-200" size={24} /><h2 className="mt-4 text-lg font-semibold">Connect your wallet to enter</h2><p className="mt-2 text-sm leading-6 text-[#a8a3b3]">You can only submit images generated and saved by your Cabi account.</p></section>;
  if (phase === "loading") return <p className="mt-8 text-center text-sm text-[#a8a3b3]" role="status">Loading image contests…</p>;
  if (phase === "error") return <section className="glass mt-8 rounded-[24px] p-7 text-center"><p className="text-sm text-[#d5d0de]">{notice}</p><button type="button" onClick={() => void load()} className="focus-ring mt-4 h-10 rounded-xl border border-white/[0.08] px-4 text-xs font-semibold">Try again</button></section>;

  return (
    <section className="mt-7 space-y-5">
      <p className="text-xs leading-6 text-[#a8a3b3]">Choose from your saved Cabi images. Each wallet may enter once per contest; an admin selects the winner. There is no public vote.</p>
      {notice ? <p role="status" className="rounded-xl bg-violet-300/[0.07] px-4 py-3 text-xs text-violet-100">{notice}</p> : null}
      {data.contests.length === 0 ? <div className="glass rounded-[24px] p-8 text-center"><Clock3 className="mx-auto text-violet-200" size={23} /><h2 className="mt-4 text-lg font-semibold">No contests are open yet</h2><p className="mt-2 text-sm text-[#8e889b]">New Cabi image contests will show up here.</p></div> : null}
      {data.contests.map((contest) => {
        const winner = contest.entries.find((entry) => entry.id === contest.winnerEntryId);
        return (
          <article key={contest.id} className="glass overflow-hidden rounded-[24px] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0"><h2 className="text-lg font-semibold text-white">{contest.title}</h2><p className="mt-2 text-sm leading-6 text-[#a8a3b3]">{contest.description}</p></div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[.1em] ${contest.status === "FINALIZED" ? "bg-emerald-300/[0.08] text-emerald-200" : contest.canSubmit ? "bg-violet-300/[0.09] text-violet-100" : "bg-white/[0.05] text-[#8e889b]"}`}>{contest.canSubmit ? "Open" : contest.status === "FINALIZED" ? "Finalized" : "Closed"}</span>
            </div>
            <p className="mt-3 text-[11px] text-[#777180]">{new Date(contest.startsAt).toLocaleString()} — {new Date(contest.endsAt).toLocaleString()}</p>
            {winner ? <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-200/[0.07] px-3 py-2 text-xs text-amber-100"><Trophy size={14} /> Winner: {winner.username}</div> : null}
            {contest.ownEntryId ? <p className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><Check size={14} /> Your image has been submitted.</p> : null}
            {contest.canSubmit ? (
              <div className="mt-5">
                <h3 className="text-xs font-semibold text-white">Choose one of your Cabi images</h3>
                {data.myImages.length === 0 ? <p className="mt-3 text-xs leading-5 text-[#8e889b]">You do not have a saved image yet. Ask Cabi to make one in chat first.</p> : (
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.myImages.map((image) => (
                      <li key={image.id} className="overflow-hidden rounded-[18px] bg-white/[0.025]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the image URL is a short-lived signed storage URL. */}
                        <img src={image.url} alt={image.prompt} loading="lazy" className="aspect-square w-full object-cover" />
                        <div className="p-3"><p className="line-clamp-2 text-xs leading-5 text-[#d5d0de]">{image.prompt}</p><button type="button" disabled={busy !== null} onClick={() => void submit(contest.id, image.id)} className="focus-ring mt-3 h-9 w-full rounded-xl bg-violet-200 text-xs font-semibold text-[#160f27] disabled:opacity-50">{busy === `${contest.id}:${image.id}` ? "Submitting…" : "Submit this image"}</button></div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            {contest.entries.length > 0 ? <div className="mt-5"><h3 className="text-xs font-semibold text-white">Entries ({contest.entries.length})</h3><ul className="mt-3 grid gap-3 sm:grid-cols-3">{contest.entries.map((entry) => <li key={entry.id} className="overflow-hidden rounded-[18px] bg-white/[0.025]">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL. */}
              <img src={entry.imageUrl} alt={`Cabi contest entry by ${entry.username}`} loading="lazy" className="aspect-square w-full object-cover" /><p className="p-3 text-xs text-[#a8a3b3]">{entry.username}{entry.id === contest.winnerEntryId ? " · Winner" : ""}</p></li>)}</ul></div> : null}
          </article>
        );
      })}
    </section>
  );
}
