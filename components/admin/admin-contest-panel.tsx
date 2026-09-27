"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Trophy } from "lucide-react";

type ContestRow = { id: string; title: string; description: string; starts_at: string; ends_at: string; status: string; winner_entry_id: string | null };
type Entry = { id: string; contestId: string; imageGenerationId: string; username: string; submittedAt: string; imageUrl: string };
type Payload = { contests: ContestRow[]; entries: Entry[] };

export function AdminContestPanel() {
  const [data, setData] = useState<Payload>({ contests: [], entries: [] });
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ title: "", description: "", startsAt: "", endsAt: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/contest", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json() as Payload);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/contest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setNotice(payload.error ?? "That action failed."); return; }
      setNotice(success);
      await load();
    } catch {
      setNotice("That action failed.");
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void act({ action: "create", title: form.title, description: form.description, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }, "Contest created as draft.");
  };

  if (phase === "loading") return <p className="mt-8 text-sm text-[#a8a3b3]" role="status">Loading contests…</p>;
  if (phase === "error") return <div className="mt-8"><p className="text-sm text-rose-200">Could not load contests.</p><button onClick={() => void load()} className="focus-ring mt-3 h-9 rounded-lg border border-white/[0.1] px-3 text-xs">Try again</button></div>;

  return (
    <div className="mt-7 space-y-6">
      {notice ? <p role="status" className="rounded-xl bg-violet-300/[0.07] px-4 py-3 text-xs text-violet-100">{notice}</p> : null}
      <form onSubmit={create} className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white">Create a contest</h2>
        <p className="mt-1 text-xs leading-5 text-[#777180]">Contests are admin judged. Entries must come from a participant&apos;s saved Cabi images.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[#a8a3b3]">Title<input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
          <label className="text-xs text-[#a8a3b3]">Description<input maxLength={2000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
          <label className="text-xs text-[#a8a3b3]">Starts<input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
          <label className="text-xs text-[#a8a3b3]">Ends<input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
        </div>
        <button type="submit" disabled={busy || !form.title.trim()} className="focus-ring mt-4 h-10 rounded-xl bg-violet-200 px-4 text-xs font-semibold text-[#160f27] disabled:opacity-40">Create draft</button>
      </form>

      {data.contests.length === 0 ? <p className="rounded-[22px] border border-white/[0.06] p-6 text-sm text-[#8e889b]">No contest history yet.</p> : data.contests.map((contest) => {
        const entries = data.entries.filter((entry) => entry.contestId === contest.id);
        return (
          <section key={contest.id} className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-white">{contest.title}</h2><p className="mt-1 text-xs text-[#777180]">{new Date(contest.starts_at).toLocaleString()} — {new Date(contest.ends_at).toLocaleString()}</p><p className="mt-2 text-xs leading-5 text-[#a8a3b3]">{contest.description}</p></div><span className="rounded-full bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.1em] text-violet-100">{contest.status}</span></div>
            <div className="mt-4 flex flex-wrap gap-2">
              {contest.status !== "FINALIZED" ? <>
                <button type="button" disabled={busy} onClick={() => void act({ action: "status", contestId: contest.id, status: "OPEN" }, "Contest opened.")} className="focus-ring h-9 rounded-lg border border-violet-200/[0.2] px-3 text-xs text-violet-100 disabled:opacity-40">Open</button>
                <button type="button" disabled={busy} onClick={() => void act({ action: "status", contestId: contest.id, status: "CLOSED" }, "Contest closed.")} className="focus-ring h-9 rounded-lg border border-white/[0.1] px-3 text-xs text-[#d5d0de] disabled:opacity-40">Close</button>
              </> : null}
            </div>
            {entries.length > 0 ? <div className="mt-5"><h3 className="flex items-center gap-2 text-xs font-semibold text-white"><ImagePlus size={14} /> Entries ({entries.length})</h3><ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{entries.map((entry) => <li key={entry.id} className="overflow-hidden rounded-[18px] bg-white/[0.025]">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL. */}
              <img src={entry.imageUrl} alt={`Contest entry by ${entry.username}`} loading="lazy" className="aspect-square w-full object-cover" /><div className="flex items-center justify-between gap-2 p-3"><span className="truncate text-xs text-[#d5d0de]">{entry.username}</span>{contest.status !== "FINALIZED" ? <button type="button" disabled={busy} onClick={() => void act({ action: "winner", contestId: contest.id, entryId: entry.id }, "Contest winner finalized.")} className="focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-amber-200/[0.12] px-2.5 text-[10px] font-semibold text-amber-100 disabled:opacity-40"><Trophy size={12} /> Winner</button> : contest.winner_entry_id === entry.id ? <span className="text-[10px] text-amber-100">Winner</span> : null}</div></li>)}</ul></div> : <p className="mt-4 text-xs text-[#777180]">No entries.</p>}
          </section>
        );
      })}
    </div>
  );
}
