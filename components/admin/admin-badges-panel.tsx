"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ProfileBadgeChip } from "@/components/profile/profile-badge-chip";

type Badge = { id: string; slug: string; label: string; description: string; icon: string; color: string; createdBy: string; createdAt: string; awardCount: number };
type Action = "assign" | "revoke";

export function AdminBadgesPanel() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [createForm, setCreateForm] = useState({ label: "", description: "", icon: "award", color: "violet" });
  const [assignment, setAssignment] = useState({ badgeId: "", username: "", action: "assign" as Action });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/badges", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { badges: Badge[] };
      setBadges(payload.badges);
      setAssignment((current) => ({ ...current, badgeId: current.badgeId || payload.badges[0]?.id || "" }));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const mutate = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/badges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setNotice(payload.error ?? "That badge action failed."); return; }
      setNotice(success);
      await load();
    } catch {
      setNotice("That badge action failed.");
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void mutate({ action: "create", ...createForm }, "Badge created.");
    setCreateForm({ label: "", description: "", icon: "award", color: "violet" });
  };

  const assign = (event: FormEvent) => {
    event.preventDefault();
    void mutate({ action: assignment.action, badgeId: assignment.badgeId, username: assignment.username }, assignment.action === "assign" ? "Badge assigned." : "Badge assignment removed.");
  };

  if (phase === "loading") return <p role="status" className="mt-8 text-sm text-[#a8a3b3]">Loading profile badges…</p>;
  if (phase === "error") return <div className="mt-8"><p className="text-sm text-rose-200">Could not load badges.</p><button type="button" onClick={() => void load()} className="focus-ring mt-3 h-9 rounded-lg border border-white/[0.1] px-3 text-xs">Try again</button></div>;

  return <div className="mt-7 space-y-5">
    {notice ? <p role="status" className="rounded-xl bg-violet-300/[0.07] px-4 py-3 text-xs text-violet-100">{notice}</p> : null}
    <form onSubmit={create} className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-white">Create a profile badge</h2>
      <p className="mt-1 text-xs leading-5 text-[#777180]">Badges are custom identity items. They remain separate from automatically earned achievements.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[#a8a3b3]">Name<input required minLength={2} maxLength={40} value={createForm.label} onChange={(event) => setCreateForm((current) => ({ ...current, label: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
        <label className="text-xs text-[#a8a3b3]">Description<input maxLength={240} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} className="field mt-1 h-10 w-full" /></label>
        <label className="text-xs text-[#a8a3b3]">Icon<select value={createForm.icon} onChange={(event) => setCreateForm((current) => ({ ...current, icon: event.target.value }))} className="field mt-1 h-10 w-full"><option value="award">Award</option><option value="star">Star</option><option value="sparkles">Sparkles</option><option value="crown">Crown</option><option value="heart">Heart</option><option value="image">Image</option><option value="leaf">Leaf</option></select></label>
        <label className="text-xs text-[#a8a3b3]">Color<select value={createForm.color} onChange={(event) => setCreateForm((current) => ({ ...current, color: event.target.value }))} className="field mt-1 h-10 w-full"><option value="violet">Violet</option><option value="teal">Teal</option><option value="amber">Amber</option><option value="rose">Rose</option><option value="blue">Blue</option></select></label>
      </div>
      <button type="submit" disabled={busy || !createForm.label.trim()} className="focus-ring mt-4 h-10 rounded-xl bg-violet-200 px-4 text-xs font-semibold text-[#160f27] disabled:opacity-40">Create badge</button>
    </form>

    <form onSubmit={assign} className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-white">Assign a badge</h2>
      <p className="mt-1 text-xs leading-5 text-[#777180]">Assignments use a member&apos;s completed profile name. They can choose up to three badges to showcase.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs text-[#a8a3b3]">Badge<select required value={assignment.badgeId} onChange={(event) => setAssignment((current) => ({ ...current, badgeId: event.target.value }))} className="field mt-1 h-10 w-full"><option value="" disabled>Select badge</option>{badges.map((badge) => <option key={badge.id} value={badge.id}>{badge.label}</option>)}</select></label>
        <label className="text-xs text-[#a8a3b3]">Profile name<input required minLength={2} maxLength={40} value={assignment.username} onChange={(event) => setAssignment((current) => ({ ...current, username: event.target.value }))} className="field mt-1 h-10 w-full" placeholder="membername" /></label>
        <label className="text-xs text-[#a8a3b3]">Action<select value={assignment.action} onChange={(event) => setAssignment((current) => ({ ...current, action: event.target.value as Action }))} className="field mt-1 h-10 w-full"><option value="assign">Assign</option><option value="revoke">Remove</option></select></label>
      </div>
      <button type="submit" disabled={busy || badges.length === 0 || !assignment.badgeId || !assignment.username.trim()} className="focus-ring mt-4 h-10 rounded-xl border border-violet-200/[0.14] bg-violet-300/[0.06] px-4 text-xs font-semibold text-violet-100 disabled:opacity-40">{assignment.action === "assign" ? "Assign badge" : "Remove badge"}</button>
    </form>

    <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-white">Badge catalog</h2>
      {badges.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-white/[0.08] p-5 text-center text-xs text-[#8e889b]">No profile badges have been created.</p> : <ul className="mt-3 divide-y divide-white/[0.05]">{badges.map((badge) => <li key={badge.id} className="flex flex-wrap items-center gap-3 py-3"><ProfileBadgeChip badge={badge} /><span className="min-w-0 flex-1 text-xs text-[#8e889b]">{badge.description || "No description"}</span><span className="text-[10px] text-[#777180]">{badge.awardCount} assigned</span></li>)}</ul>}
    </section>
  </div>;
}
