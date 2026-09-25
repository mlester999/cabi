"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type ImageError = {
  id: string | null;
  time: string | null;
  requestId: string | null;
  status: string;
  user: string;
  stage: string | null;
  provider: string | null;
  model: string | null;
  category: unknown;
  httpStatus: number | null;
  database: {
    code: string | null;
    reason: string;
    table: string | null;
    column: string | null;
    constraint: string | null;
  } | null;
  details: {
    message: string | null;
    promptHash: string | null;
    promptLength: number | null;
    scene: string | null;
    expression: string | null;
    outfit: string | null;
    promptRetryCount: number;
    referenceConditioned: boolean;
    providerError: { code: string | null; type: string | null; parameter: string | null; message: string | null } | null;
  };
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function categoryLabel(value: unknown) {
  return typeof value === "string" && value ? value.replace(/_/gu, " ") : "unknown";
}

/** Owner-only generation activity. Raw prompts and credentials never render here. */
export function AdminImageErrorsPanel() {
  const [errors, setErrors] = useState<ImageError[]>([]);
  const [detailedDiagnosticsAvailable, setDetailedDiagnosticsAvailable] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/admin/images?section=errors", { cache: "no-store" });
      if (!response.ok) throw new Error("diagnostics unavailable");
      const payload = await response.json() as { errors?: ImageError[]; detailedDiagnosticsAvailable?: boolean };
      setErrors(Array.isArray(payload.errors) ? payload.errors : []);
      setDetailedDiagnosticsAvailable(payload.detailedDiagnosticsAvailable !== false);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section id="recent-generation-runs" className="scroll-mt-6 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-white"><AlertTriangle size={15} className="text-amber-200" aria-hidden="true" /> Recent Generation Runs</h2>
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">Owner-only activity and safe diagnostics. Prompts, API keys, URLs, and provider response bodies are omitted.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={state === "loading"} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--cabi-border)] px-3 text-[11px] font-semibold text-[var(--cabi-text-secondary)] disabled:opacity-40">
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>

      {state === "loading" ? <p className="mt-4 text-xs text-[var(--cabi-text-muted)]" role="status">Loading diagnostics…</p> : null}
      {state === "error" ? <p className="mt-4 text-xs text-rose-200" role="alert">Recent diagnostics could not be loaded.</p> : null}
      {state === "ready" && !detailedDiagnosticsAvailable ? <p className="mt-3 text-[11px] text-amber-200">Detailed diagnostics are unavailable; basic generation activity is still shown.</p> : null}
      {state === "ready" && errors.length === 0 ? <p className="mt-4 text-xs text-[var(--cabi-text-muted)]">No recent image generation runs.</p> : null}

      {errors.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--cabi-hairline)]">
          <table className="w-full min-w-[860px] text-left text-[11px]">
            <thead className="bg-black/20 text-[10px] uppercase tracking-[.1em] text-[var(--cabi-text-faint)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">Request ID</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Stage</th>
                <th className="px-3 py-2 font-semibold">DB code</th>
                <th className="px-3 py-2 font-semibold">Model</th>
                <th className="px-3 py-2 font-semibold">HTTP</th>
                <th className="px-3 py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {errors.map((entry, index) => (
                <tr key={entry.id ?? `${entry.requestId ?? "error"}-${index}`} className="align-top text-[var(--cabi-text-secondary)]">
                  <td className="whitespace-nowrap px-3 py-3">{formatTime(entry.time)}</td>
                  <td className="max-w-[130px] break-all px-3 py-3 font-mono text-[10px]">{entry.requestId ?? "—"}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${entry.status === "FAILED" ? "bg-rose-300/10 text-rose-200" : entry.status === "COMPLETED" ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-[var(--cabi-text-secondary)]"}`}>{entry.status}</span></td>
                  <td className="px-3 py-3">{entry.stage ?? "—"}</td>
                  <td className="px-3 py-3 font-mono">{entry.database?.code ?? "—"}</td>
                  <td className="px-3 py-3">{entry.model ?? "—"}</td>
                  <td className="px-3 py-3">{entry.httpStatus ?? "—"}</td>
                  <td className="px-3 py-3">
                    <details>
                      <summary className="cabi-focus cursor-pointer text-[var(--cabi-primary)]">View details</summary>
                      <dl className="mt-2 min-w-[180px] space-y-1 text-[10px] text-[var(--cabi-text-muted)]">
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Provider / user</dt><dd>{entry.provider ?? "—"} · {entry.user}</dd></div>
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Message</dt><dd>{entry.details.message ?? "—"}</dd></div>
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Category</dt><dd className="capitalize">{categoryLabel(entry.category)}</dd></div>
                        {entry.database ? <>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Database reason</dt><dd>{entry.database.reason.replace(/_/gu, " ")}</dd></div>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Table / column</dt><dd className="font-mono">{entry.database.table ?? "—"} · {entry.database.column ?? "—"}</dd></div>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Constraint</dt><dd className="font-mono">{entry.database.constraint ?? "—"}</dd></div>
                        </> : null}
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Prompt hash / length</dt><dd className="font-mono">{entry.details.promptHash ?? "—"} · {entry.details.promptLength ?? "—"}</dd></div>
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Scene</dt><dd>{entry.details.scene ?? "—"}</dd></div>
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Expression / outfit</dt><dd>{entry.details.expression ?? "—"} · {entry.details.outfit ?? "—"}</dd></div>
                        <div><dt className="uppercase tracking-[.08em] text-white/35">Retries / reference</dt><dd>{entry.details.promptRetryCount} · {entry.details.referenceConditioned ? "attached" : "text only"}</dd></div>
                        {entry.details.providerError ? <>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Together error</dt><dd className="break-words">{entry.details.providerError.message ?? "—"}</dd></div>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Provider code / type</dt><dd className="break-words font-mono">{entry.details.providerError.code ?? "—"} · {entry.details.providerError.type ?? "—"}</dd></div>
                          <div><dt className="uppercase tracking-[.08em] text-white/35">Provider parameter</dt><dd className="break-words font-mono">{entry.details.providerError.parameter ?? "—"}</dd></div>
                        </> : null}
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
