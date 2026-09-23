"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, XCircle } from "lucide-react";

type Settings = {
  enabled: boolean;
  provider: "openai" | "stability" | "replicate" | "custom";
  baseUrl: string;
  model: string;
  defaultAspectRatio: string;
  defaultQuality: string;
  dailyLimit: number;
  allowGuestGeneration: boolean;
  hasApiKey: boolean;
  keyLastFour: string | null;
};

const emptySettings: Settings = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-image-1",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  hasApiKey: false,
  keyLastFour: null,
};

/**
 * Admin image-generation settings.
 *
 * The API key is write-only. It is sent once, encrypted server-side with
 * APP_ENCRYPTION_KEY, and never read back: this form only ever shows whether a
 * key exists and its last four characters.
 */
export function AdminImagesPanel() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/images", { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json() as { settings?: Settings };
        if (payload.settings) setSettings(payload.settings);
      }
    } finally {
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (action: "save" | "test") => {
    setBusy(action);
    setNotice("");
    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          action,
          // Only sent when the operator typed one. The stored key is never echoed.
          ...(apiKey ? { apiKey } : {}),
          ...(clearApiKey ? { clearApiKey: true } : {}),
        }),
      });
      const payload = await response.json() as { error?: string; message?: string; settings?: Settings; ok?: boolean };
      if (!response.ok) { setNotice(payload.message ?? payload.error ?? "That did not work."); return; }
      if (payload.settings) setSettings(payload.settings);
      if (action === "save") { setApiKey(""); setClearApiKey(false); setNotice("Saved."); }
      else setNotice(payload.message ?? "Connection OK.");
    } catch {
      setNotice("That did not work.");
    } finally {
      setBusy(null);
    }
  };

  if (phase === "loading") return <p className="mt-8 text-sm text-[#a8a3b3]" role="status">Loading image settings...</p>;

  const field = "focus-ring h-11 w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 text-sm text-white";
  const label = "block text-[10px] font-semibold uppercase tracking-[.14em] text-[#777180]";

  return (
    <div className="space-y-5">
      {notice ? <p role="status" className="rounded-xl border border-violet-200/[0.16] bg-violet-300/[0.06] px-3 py-2 text-xs text-violet-100">{notice}</p> : null}

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ImagePlus size={15} className="text-violet-300" aria-hidden="true" /> Cabi image generation</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
          Cabi-only image generation. The provider is independent of the chat model, so one can be down without breaking the other.
        </p>

        <label className="mt-5 flex items-center gap-3">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="focus-ring h-4 w-4 accent-violet-400" />
          <span className="text-[13px] font-medium text-white">Enable image generation</span>
        </label>
        <label className="mt-3 flex items-center gap-3">
          <input type="checkbox" checked={settings.allowGuestGeneration} onChange={(event) => setSettings({ ...settings, allowGuestGeneration: event.target.checked })} className="focus-ring h-4 w-4 accent-violet-400" />
          <span className="text-[13px] font-medium text-white">Allow guests to generate</span>
        </label>
        <p className="ml-7 mt-1 text-[11px] text-[#625d6d]">Off by default. Generation costs money per call, so it is tied to a wallet for quota and abuse control.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Provider</span>
            <select value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value as Settings["provider"] })} className={`mt-2 ${field}`}>
              <option value="openai">OpenAI-compatible</option>
              <option value="stability">Stability AI</option>
              <option value="replicate">Replicate</option>
              <option value="custom">Custom endpoint</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Model</span>
            <input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} className={`mt-2 ${field}`} />
          </label>
          <label className="block sm:col-span-2">
            <span className={label}>Base URL</span>
            <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" className={`mt-2 ${field}`} />
            <span className="mt-1.5 block text-[11px] text-[#625d6d]">HTTPS only.</span>
          </label>
          <label className="block">
            <span className={label}>Default aspect ratio</span>
            <select value={settings.defaultAspectRatio} onChange={(event) => setSettings({ ...settings, defaultAspectRatio: event.target.value })} className={`mt-2 ${field}`}>
              {["1:1", "16:9", "9:16", "3:2", "2:3"].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Default quality</span>
            <select value={settings.defaultQuality} onChange={(event) => setSettings({ ...settings, defaultQuality: event.target.value })} className={`mt-2 ${field}`}>
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Max generations per user / day</span>
            <input type="number" min={1} max={100} value={settings.dailyLimit} onChange={(event) => setSettings({ ...settings, dailyLimit: Number(event.target.value) })} className={`mt-2 ${field}`} />
          </label>
        </div>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <span className={label}>API key</span>
          {settings.hasApiKey && !clearApiKey ? (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-emerald-200">
              <CheckCircle2 size={13} aria-hidden="true" /> A key is stored, ending {settings.keyLastFour ?? "----"}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-[#8e889b]">
              <XCircle size={13} aria-hidden="true" /> No key stored
            </p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
            placeholder="Paste a new key to replace it"
            autoComplete="off"
            aria-label="API key"
            className={`mt-3 ${field}`}
          />
          <p className="mt-1.5 text-[11px] leading-5 text-[#625d6d]">
            Encrypted at rest with APP_ENCRYPTION_KEY. The key is never returned to a browser, never logged, and never stored in client state.
          </p>
          {settings.hasApiKey ? (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} className="focus-ring h-3.5 w-3.5 accent-rose-400" />
              <span className="text-[11px] text-rose-200">Remove the stored key</span>
            </label>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={busy !== null} onClick={() => void submit("save")} className="focus-ring h-11 rounded-xl bg-violet-300 px-5 text-sm font-bold text-[#160f22] disabled:opacity-40">
            {busy === "save" ? "Saving..." : "Save"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void submit("test")} className="focus-ring h-11 rounded-xl border border-white/[0.1] px-5 text-sm font-semibold text-[#d5d0de] disabled:opacity-40">
            {busy === "test" ? "Testing..." : "Test connection"}
          </button>
        </div>
      </section>

      <section className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-white">Required storage buckets</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[#777180]">
          Create two private buckets in Supabase Storage. Objects are served through short-lived signed URLs, so neither needs to be public.
        </p>
        <ul className="mt-3 space-y-1.5 font-mono text-[12px] text-violet-200">
          <li>cabi-generations</li>
          <li>avatars</li>
        </ul>
      </section>
    </div>
  );
}