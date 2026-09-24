"use client";

import { Banner, Header } from "@/components/admin/ai-settings-panel";
import { PreviewStartButton } from "@/components/admin/preview-start-button";
import { siteModeDescriptions, siteModeLabels, type SiteMode } from "@/lib/site/mode-shared";
import { AlertTriangle, Check, ExternalLink, LoaderCircle, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type SiteModeState = {
  mode: SiteMode;
  source: "env" | "database" | "default";
  override: boolean;
  stored: SiteMode | null;
  environmentMode: SiteMode | null;
  defaultMode: SiteMode;
  databaseReady: boolean;
};

const modeOrder: SiteMode[] = ["PRELAUNCH", "LIVE", "MAINTENANCE"];

const sourceLabel: Record<SiteModeState["source"], string> = {
  env: "Environment override",
  database: "Saved in dashboard",
  default: "Built-in default",
};

/**
 * Website mode control with a guarded one-click launch.
 *
 * PRELAUNCH -> LIVE always asks for confirmation first, and the change is
 * written to the database so it applies immediately without a redeploy. When a
 * deployment-level environment override is set, the panel says so instead of
 * pretending the save took effect.
 */
export function SiteModePanel() {
  const [state, setState] = useState<SiteModeState>();
  const [draft, setDraft] = useState<SiteMode>("PRELAUNCH");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const load = async () => {
    const response = await fetch("/api/admin/site-mode", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as SiteModeState;
    setState(payload);
    setDraft(payload.mode);
  };

  // Loading the current mode is this effect's external synchronization.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const save = async (mode: SiteMode) => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/site-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; mode?: SiteMode; override?: boolean };
      if (!response.ok) {
        setError(payload.error ?? "Couldn't save the website mode.");
        return;
      }
      setNotice(mode === "LIVE" ? "Cabi is public. Launch recorded in the audit log." : `Website mode set to ${siteModeLabels[mode]}.`);
      setConfirming(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const dirty = Boolean(state) && draft !== state!.mode;

  return (
    <section>
      <Header
        eyebrow="Launch control"
        title="Website mode"
        description="Choose what the public sees. The application itself is never removed — PRELAUNCH and MAINTENANCE simply keep it private while you keep full access through the admin preview."
      />

      {state && !state.databaseReady && <Banner>Connect Supabase before saving. Until then the site stays in {siteModeLabels[state.mode]}.</Banner>}

      {state?.override && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-xs leading-5 text-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Environment override is active.</span>{" "}
            <code className="font-mono">SITE_MODE_OVERRIDE={state.environmentMode}</code> wins over this dashboard, so changes saved here will not
            affect the public site until that variable is removed.
          </p>
        </div>
      )}

      <div className="mt-5 rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5">
        <fieldset disabled={busy || !state?.databaseReady}>
          <legend className="sr-only">Website mode</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {modeOrder.map((mode) => {
              const active = draft === mode;
              return (
                <label
                  key={mode}
                  className={`flex cursor-pointer flex-col rounded-2xl border p-4 transition ${active ? "border-violet-300/35 bg-violet-300/[0.07]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12]"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{siteModeLabels[mode]}</span>
                    <input
                      type="radio"
                      name="site-mode"
                      value={mode}
                      checked={active}
                      onChange={() => { setDraft(mode); setConfirming(false); setNotice(undefined); }}
                      className="accent-violet-300"
                    />
                  </span>
                  <span className="mt-2 text-[11px] leading-5 text-[#777180]">{siteModeDescriptions[mode]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <dl className="mt-5 grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[#777180]">Effective mode</dt>
            <dd className="mt-1 font-semibold text-violet-100">{state ? siteModeLabels[state.mode] : "Loading…"}</dd>
          </div>
          <div>
            <dt className="text-[#777180]">Source</dt>
            <dd className="mt-1 text-[#a8a3b3]">{state ? sourceLabel[state.source] : "—"}</dd>
          </div>
          <div>
            <dt className="text-[#777180]">Saved value</dt>
            <dd className="mt-1 text-[#a8a3b3]">{state?.stored ? siteModeLabels[state.stored] : "Not saved yet"}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !dirty || !state?.databaseReady}
            onClick={() => { if (draft === "LIVE") setConfirming(true); else void save(draft); }}
            className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] transition hover:brightness-105 disabled:opacity-40"
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
            {draft === "LIVE" ? "Launch Cabi" : "Save mode"}
          </button>
          <PreviewStartButton />
          <Link href="/" className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-[#d5d0de] transition hover:bg-white/[0.06]">
            <ExternalLink size={15} /> View public page
          </Link>
        </div>

        {notice && <p role="status" className="mt-3 text-xs text-violet-200">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="launch-cabi-title">
          <button className="absolute inset-0" onClick={() => setConfirming(false)} aria-label="Cancel launch" />
          <div className="glass relative w-full max-w-md rounded-[28px] p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.07] text-violet-200">
              <Rocket size={21} aria-hidden="true" />
            </span>
            <h2 id="launch-cabi-title" className="mt-5 text-xl font-semibold tracking-[-.03em]">Make Cabi public?</h2>
            <p className="mt-2 text-sm leading-6 text-[#a8a3b3]">
              Every visitor will be able to open the full application at <code className="font-mono text-[#ddd6fe]">/</code>, connect a wallet, and start chats.
              This applies immediately and is recorded in the audit log.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="focus-ring h-11 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm font-semibold text-[#d5d0de] transition hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save("LIVE")}
                className="focus-ring flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-200 text-sm font-semibold text-[#160f27] transition hover:brightness-105 disabled:opacity-50"
              >
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Rocket size={15} />} Launch Cabi
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
