"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";

/**
 * Owner control for Cabi's activity lines.
 *
 * The shipped defaults are shown read-only and are never removed: an owner adds
 * lines, and the rotation is the union of both. That is what keeps a category from
 * ever running out of something to say, which is the failure mode this whole
 * feature exists to prevent.
 *
 * Nothing here is required for the feature to work — with no configuration at all,
 * the built-in lines are already what Cabi says.
 */

type Category = "CHAT_THINKING" | "IMAGE_GENERATING" | "MEMORY_LOADING" | "WALLET_VERIFYING" | "PROFILE_SAVING" | "IMAGE_SAVING";

type Payload = {
  settings: { enabled: boolean; custom: Partial<Record<Category, string[]>> };
  defaults: Record<Category, readonly string[]>;
  categories: readonly Category[];
  maxPerCategory: number;
};

const categoryLabels: Record<Category, string> = {
  CHAT_THINKING: "Chat thinking",
  IMAGE_GENERATING: "Image generation",
  MEMORY_LOADING: "Memory",
  WALLET_VERIFYING: "Wallet",
  PROFILE_SAVING: "Profile saving",
  IMAGE_SAVING: "Image saving",
};

export function CabiStatusMessagesPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [custom, setCustom] = useState<Partial<Record<Category, string[]>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<Category, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/status-messages", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as Payload;
      setPayload(next);
      setEnabled(next.settings.enabled);
      setCustom(next.settings.custom ?? {});
    } catch {
      // The screen stays empty; the built-in lines are what Cabi uses anyway.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async () => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/status-messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: { enabled, custom } }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Those messages could not be saved."); return; }
      setNotice("Activity messages saved.");
      await load();
    } catch {
      setError("Those messages could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/status-messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "reset" }),
      });
      if (!response.ok) { setError("The messages could not be reset."); return; }
      setNotice("Reset to the built-in lines.");
      await load();
    } catch {
      setError("The messages could not be reset.");
    } finally {
      setBusy(false);
    }
  };

  const addLine = (category: Category) => {
    const line = (drafts[category] ?? "").trim();
    if (!line) return;
    const limit = payload?.maxPerCategory ?? 20;
    setCustom((current) => {
      const existing = current[category] ?? [];
      if (existing.length >= limit) return current;
      return { ...current, [category]: [...existing, line] };
    });
    setDrafts((current) => ({ ...current, [category]: "" }));
  };

  const removeLine = (category: Category, index: number) => {
    setCustom((current) => {
      const existing = [...(current[category] ?? [])];
      existing.splice(index, 1);
      return { ...current, [category]: existing };
    });
  };

  const field = "focus-ring h-11 w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 text-sm text-white";
  const label = "block text-[10px] font-semibold uppercase tracking-[.14em] text-[#777180]";
  const categories = payload?.categories ?? (Object.keys(categoryLabels) as Category[]);

  return (
    <section className="mt-7 rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Cabi Activity Messages</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#777180]">
            What Cabi says while she is working. The built-in lines are always used; anything added here is appended to
            them, so a category can never end up with nothing to say. The rotation timing and the escalation for long
            waits are fixed in code and are not configurable.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[#d5d0de]">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="accent-violet-300" />
          Use custom messages
        </label>
      </div>

      {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-300/[0.18] bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100">{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-300/[0.2] bg-rose-300/[0.06] px-3 py-2 text-xs text-rose-100">{error}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {categories.map((category) => (
          <div key={category} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-white">{categoryLabels[category]}</h3>
              <span className="text-[10px] text-[#625d6d]">{(custom[category] ?? []).length} custom</span>
            </div>

            <ul className="mt-3 space-y-1.5">
              {(payload?.defaults[category] ?? []).map((line) => (
                <li key={line} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5 text-[11px] text-[#8e889b]">
                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-[#4d4859]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{line}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-[.1em] text-[#4d4859]">built-in</span>
                </li>
              ))}
              {(custom[category] ?? []).map((line, index) => (
                <li key={`${line}-${index}`} className="flex items-start gap-2 rounded-lg border border-violet-200/[0.14] bg-violet-300/[0.05] px-2.5 py-1.5 text-[11px] text-violet-100">
                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-violet-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{line}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(category, index)}
                    className="focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#8e889b] hover:bg-white/[0.06] hover:text-rose-200"
                    aria-label={`Remove custom message: ${line}`}
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <input
                value={drafts[category] ?? ""}
                onChange={(event) => setDrafts((current) => ({ ...current, [category]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLine(category); } }}
                maxLength={120}
                placeholder="Add a line Cabi can say"
                aria-label={`Add a ${categoryLabels[category].toLowerCase()} message`}
                className={field}
              />
              <button
                type="button"
                onClick={() => addLine(category)}
                className="focus-ring inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-semibold text-[#d5d0de]"
              >
                <Plus size={13} aria-hidden="true" /> Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] disabled:opacity-40"
        >
          <Save size={15} aria-hidden="true" /> {busy ? "Saving…" : "Save messages"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reset()}
          className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm disabled:opacity-40"
        >
          <RotateCcw size={15} aria-hidden="true" /> Reset to defaults
        </button>
        <p className="text-[11px] text-[#625d6d]">
          With custom messages off, or with nothing added, Cabi uses the built-in lines exactly as shipped.
        </p>
      </div>

      <p className={label} aria-hidden="true" />
    </section>
  );
}
