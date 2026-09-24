"use client";

import { useCallback, useEffect, useState } from "react";

import { defaultFeatureFlags, featureFlagKeys, type FeatureFlags } from "@/lib/config/feature-flags";

/**
 * Admin feature-flag panel.
 *
 * Flags are read and written server-side. This form only reflects what the
 * server reports and asks it to change.
 */
export function AdminFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlags>(defaultFeatureFlags);
  const [defaults, setDefaults] = useState<FeatureFlags>(defaultFeatureFlags);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/flags", { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json() as { flags?: FeatureFlags; defaults?: FeatureFlags };
        if (payload.flags) setFlags(payload.flags);
        if (payload.defaults) setDefaults(payload.defaults);
      }
    } finally {
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      const payload = await response.json() as { error?: string; flags?: FeatureFlags };
      if (!response.ok) { setNotice(payload.error ?? "Those settings could not be saved."); return; }
      if (payload.flags) setFlags(payload.flags);
      setNotice("Saved. New requests pick this up immediately.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") return <p className="text-sm text-[#a8a3b3]" role="status">Loading flags...</p>;

  return (
    <div className="space-y-5">
      {notice ? <p role="status" className="rounded-xl border border-violet-200/[0.16] bg-violet-300/[0.06] px-3 py-2 text-xs text-violet-100">{notice}</p> : null}

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Feature flags</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
          Resolved on the server and never trusted from a browser. A flag that is off closes its route and hides its
          entry points; the code and schema stay in place for later.
        </p>
        <ul className="mt-4 divide-y divide-white/[0.05]">
          {featureFlagKeys.map((key) => (
            <li key={key} className="flex items-center justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block font-mono text-[12px] text-white">{key}</span>
                {flags[key] !== defaults[key] ? (
                  <span className="mt-0.5 block text-[10px] uppercase tracking-[.12em] text-amber-100">
                    changed from default ({String(defaults[key])})
                  </span>
                ) : null}
              </span>
              <label className="flex shrink-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={(event) => setFlags({ ...flags, [key]: event.target.checked })}
                  aria-label={key}
                  className="focus-ring h-4 w-4 accent-violet-400"
                />
                <span className={`w-10 text-[11px] font-semibold ${flags[key] ? "text-emerald-200" : "text-[#8e889b]"}`}>
                  {flags[key] ? "on" : "off"}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="focus-ring mt-4 h-11 rounded-xl bg-violet-300 px-5 text-sm font-bold text-[#160f22] disabled:opacity-40"
        >
          {busy ? "Saving..." : "Save flags"}
        </button>
      </section>
    </div>
  );
}