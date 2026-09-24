"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, History, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";

import type { ImageModelDefinition } from "@/lib/image-generation/registry";

/**
 * The official Cabi reference, and the character bible around it.
 *
 * Replacing this image changes what Cabi looks like in every future generation, so
 * the panel is explicit about that before it happens, keeps every previous version
 * restorable, and reports the provider's real conditioning capability rather than
 * implying a consistency guarantee the configured model cannot make.
 *
 * The reference bytes are uploaded raw; the server decides the format by sniffing
 * the magic bytes and rejects anything that is not a real PNG, JPEG, or WebP.
 */

type ReferenceInfo = {
  source: "ADMIN_UPLOAD" | "BUNDLED";
  version: number;
  path: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  hash: string | null;
  previewUrl: string | null;
  fallbackPath: string;
};

type HistoryEntry = {
  id: string;
  version: number;
  active: boolean;
  uploadedAt: string;
  uploadedBy: string | null;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
};

type Capability = {
  provider: string;
  model: string;
  referenceConfigured: boolean;
  capabilities: { supportsReferenceImages: boolean; supportsImageToImage: boolean; supportsImageEditing?: boolean; supportsSeed: boolean };
  message: string;
};

type Bible = {
  artDirection: string;
  negative: string;
  customized: boolean;
  defaults: { artDirection: string; negative: string };
  protectedTraits: readonly string[];
};

type Payload = { reference: ReferenceInfo; history: HistoryEntry[]; provider: Capability; bible: Bible };

type CabiReferencePanelProps = {
  /** Internal provider id selected in the owner settings form. */
  selectedProvider?: string;
  /** Internal model id selected in the owner settings form. */
  selectedModel?: string;
  /** The catalog entry makes capability updates immediate, before a save. */
  selectedModelDefinition?: ImageModelDefinition | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CabiReferencePanel({ selectedProvider, selectedModel, selectedModelDefinition }: CabiReferencePanelProps = {}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<"upload" | "restore" | "bible" | "reset" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState({ artDirection: "", negative: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/cabi-reference", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as Payload;
      setPayload(next);
      setDraft({ artDirection: next.bible.artDirection, negative: next.bible.negative });
    } catch {
      // The panel simply stays empty; the rest of the console keeps working.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const upload = async (file: File) => {
    setBusy("upload");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/cabi-reference", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { error?: string; reference?: { version: number } };
      if (!response.ok) { setError(result.error ?? "That upload did not work."); return; }
      setNotice(`Reference replaced. Version ${result.reference?.version ?? "?"} is now active.`);
      setPendingFile(null);
      setConfirmReplace(false);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch {
      setError("That upload did not work.");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (id: string) => {
    setBusy("restore");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/cabi-reference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activateId: id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "That version could not be restored."); return; }
      setNotice("Previous reference restored.");
      await load();
    } catch {
      setError("That version could not be restored.");
    } finally {
      setBusy(null);
    }
  };

  const saveBible = async () => {
    setBusy("bible");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/cabi-reference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "bible", bible: draft }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Those notes could not be saved."); return; }
      setNotice("Character notes saved.");
      await load();
    } catch {
      setError("Those notes could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const resetBible = async () => {
    setBusy("reset");
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/cabi-reference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "bible-reset" }),
      });
      if (!response.ok) { setError("The character notes could not be reset."); return; }
      setNotice("Character notes reset to the shipped defaults.");
      await load();
    } catch {
      setError("The character notes could not be reset.");
    } finally {
      setBusy(null);
    }
  };

  const field = "focus-ring w-full rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 py-2.5 text-sm text-white";
  const label = "block text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--cabi-text-muted)]";
  const reference = payload?.reference;
  const preview = reference?.previewUrl ?? reference?.fallbackPath ?? "/assets/cabi-cpu-model.png";
  const effectiveProvider = selectedProvider === "together" ? "Together AI" : (selectedProvider ?? payload?.provider.provider ?? "—");
  const effectiveModel = selectedModel ?? payload?.provider.model ?? "—";
  const capability = selectedModelDefinition
    ? {
        supportsReferenceImages: selectedModelDefinition.supportsReferenceImages,
        supportsImageToImage: selectedModelDefinition.supportsImageEditing,
        supportsImageEditing: selectedModelDefinition.supportsImageEditing,
        supportsSeed: selectedModelDefinition.supportsSeed,
      }
    : payload?.provider.capabilities;
  const capabilityKnown = Boolean(selectedModelDefinition || payload?.provider);
  const supportsReference = capability?.supportsReferenceImages === true;
  const capabilityMessage = selectedModelDefinition
    ? (selectedModelDefinition.supportsReferenceImages
        ? "Cabi's official reference will be used automatically."
        : "This model uses Cabi's character specification only.")
    : payload?.provider.message ?? "Capability is resolved from the configured model.";

  return (
    <div className="space-y-5">
      {notice ? <p role="status" className="rounded-xl border border-emerald-300/[0.18] bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-rose-300/[0.2] bg-rose-300/[0.06] px-3 py-2 text-xs text-rose-100">{error}</p> : null}

      <section className="rounded-2xl border border-violet-200/[0.12] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">CABI REFERENCE</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          Official Character Reference. Every Cabi image is generated from this identity, so she stays recognizably
          herself in any outfit, pose, expression, or scene.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-[var(--cabi-border)] bg-[var(--cabi-bg-deep)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Current official Cabi reference" className="h-[180px] w-full object-contain" />
          </div>

          <div>
            <dl className="space-y-2 text-[12px]">
              <Row label="Status" value={reference?.source === "ADMIN_UPLOAD" ? "Active" : "Bundled default"} />
              <Row label="Version" value={reference ? String(reference.version) : "—"} />
              <Row label="Uploaded" value={formatDate(reference?.uploadedAt ?? null)} />
              <Row label="Uploaded by" value={reference?.uploadedBy ?? "—"} />
              <Row label="Dimensions" value={reference?.width && reference?.height ? `${reference.width} × ${reference.height}` : "—"} />
              <Row label="Used for" value="Cabi image generation" />
              <Row label="Storage" value={reference?.path ?? "—"} mono />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl bg-violet-300 px-4 text-xs font-bold text-[var(--cabi-on-primary)]"
              >
                <Upload size={14} aria-hidden="true" /> {reference?.source === "ADMIN_UPLOAD" ? "Replace Reference" : "Upload New Reference"}
              </button>
              <button
                type="button"
                onClick={() => setShowHistory((current) => !current)}
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--cabi-border)] px-4 text-xs font-semibold text-[var(--cabi-text-secondary)]"
              >
                <History size={14} aria-hidden="true" /> View History
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
              PNG, JPEG, or WebP. PNG recommended. Only one reference is active at a time, and previous versions stay
              restorable.
            </p>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Choose a new Cabi reference image"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setPendingFile(file);
            setConfirmReplace(Boolean(file));
            setNotice("");
            setError("");
          }}
        />
      </section>

      {showHistory && payload && payload.history.length > 0 ? (
        <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
          <h3 className="text-sm font-bold text-white">Reference history</h3>
          <ul className="mt-3 space-y-2">
            {payload.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-2.5">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--cabi-hairline)] bg-[var(--cabi-bg-deep)]">
                  {entry.previewUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={entry.previewUrl} alt="" className="h-full w-full object-contain" />
                    : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white">
                    Version {entry.version}
                    {entry.active ? <span className="ml-2 rounded-full border border-emerald-300/[0.2] bg-emerald-300/[0.08] px-2 py-0.5 text-[10px] text-emerald-200">ACTIVE</span> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--cabi-text-muted)]">
                    {formatDate(entry.uploadedAt)} · {entry.uploadedBy ?? "unknown"} · {entry.width && entry.height ? `${entry.width} × ${entry.height}` : "dims unknown"}
                  </p>
                </div>
                {!entry.active ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(entry.id)}
                    className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--cabi-border)] px-3 text-[11px] font-semibold text-[var(--cabi-text-secondary)] disabled:opacity-40"
                  >
                    <RotateCcw size={12} aria-hidden="true" /> Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">Provider capability</h2>
        <dl className="mt-3 space-y-2 text-[12px]">
          <Row label="Provider" value={effectiveProvider} />
          <Row label="Model" value={selectedModelDefinition?.label ?? effectiveModel} />
          {supportsReference ? <Row label="Cabi Reference" value="ACTIVE" /> : null}
          <Row
            label="Reference Conditioning"
            value={!capabilityKnown ? "CHECKING…" : supportsReference ? "SUPPORTED" : "NOT SUPPORTED"}
          />
        </dl>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-3 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          {supportsReference
            ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
            : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />}
          <span>{capabilityMessage}</span>
        </p>
        <p className="mt-2 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
          {supportsReference
            ? "No client upload or replacement is needed; the active official image is selected server-side."
            : "No reference image is sent for this model."}
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={15} className="text-[var(--cabi-primary)]" aria-hidden="true" /> CABI IDENTITY — Character Bible</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">
          Cabi&apos;s core identity is fixed in code and cannot be edited here. What follows is the surrounding art
          direction, which is additive: a bad edit makes an image less pleasant, never a different character.
        </p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {(payload?.bible.protectedTraits ?? []).map((trait) => (
            <li key={trait} className="rounded-full border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-2.5 py-1 text-[10px] text-[var(--cabi-text-secondary)]">
              {trait}
            </li>
          ))}
        </ul>

        <div className="mt-5 grid gap-4">
          <label className="block">
            <span className={label}>Art-direction notes</span>
            <textarea
              rows={3}
              value={draft.artDirection}
              onChange={(event) => setDraft((current) => ({ ...current, artDirection: event.target.value }))}
              placeholder="Optional. Appended to every prompt as composition guidance, e.g. 'soft watercolour finish, warm evening light'."
              className={`mt-2 ${field}`}
            />
          </label>
          <label className="block">
            <span className={label}>Negative guidance</span>
            <textarea
              rows={3}
              value={draft.negative}
              onChange={(event) => setDraft((current) => ({ ...current, negative: event.target.value }))}
              placeholder="Optional. Overrides the shipped negative prompt when set."
              className={`mt-2 ${field}`}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void saveBible()}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl bg-violet-300 px-4 text-xs font-bold text-[var(--cabi-on-primary)] disabled:opacity-40"
          >
            {busy === "bible" ? "Saving…" : "Save character notes"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !payload?.bible.customized}
            onClick={() => void resetBible()}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--cabi-border)] px-4 text-xs font-semibold text-[var(--cabi-text-secondary)] disabled:opacity-40"
          >
            <RotateCcw size={13} aria-hidden="true" /> {busy === "reset" ? "Resetting…" : "Reset Character Bible"}
          </button>
        </div>
      </section>

      {pendingFile && confirmReplace ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="replace-reference-title">
          <div className="glass w-full max-w-md rounded-2xl border border-violet-200/[0.14] bg-[var(--cabi-bg-deep)] p-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <h3 id="replace-reference-title" className="text-base font-semibold">Replace Cabi&apos;s official reference?</h3>
              <button type="button" onClick={() => { setPendingFile(null); setConfirmReplace(false); if (fileInput.current) fileInput.current.value = ""; }} className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-3)]" aria-label="Cancel">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-6 text-[var(--cabi-text-secondary)]">
              Future generations will use this image as Cabi&apos;s visual identity. Existing generated images will not
              change.
            </p>
            <p className="mt-2 text-[11px] text-[var(--cabi-text-faint)]">{pendingFile.name} · {(pendingFile.size / 1024).toFixed(0)} KB</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setPendingFile(null); setConfirmReplace(false); if (fileInput.current) fileInput.current.value = ""; }} className="focus-ring h-9 rounded-xl border border-[var(--cabi-border)] px-4 text-xs font-semibold text-[var(--cabi-text-secondary)]">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void upload(pendingFile)}
                className="focus-ring h-9 rounded-xl bg-violet-300 px-4 text-xs font-bold text-[var(--cabi-on-primary)] disabled:opacity-40"
              >
                {busy === "upload" ? "Uploading…" : "Replace Reference"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[.13em] text-[var(--cabi-text-muted)]">{label}</dt>
      <dd className={`min-w-0 break-all text-right text-[12px] font-medium text-white ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}
