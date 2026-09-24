"use client";

import { AlertTriangle, CheckCircle2, Eye, EyeOff, PlugZap, Save } from "lucide-react";

import { PageHeader } from "@/components/ui/cabi-primitives";
import { FormEvent, useEffect, useState } from "react";

type Config = { baseUrl: string; model: string; wireApi: "chat-completions" | "responses"; temperature: number; maxOutputTokens: number; timeoutMs: number; retryCount: number; streaming: boolean };
const empty: Config = { baseUrl: "https://api.deepseek.com", model: "", wireApi: "chat-completions", temperature: .8, maxOutputTokens: 1200, timeoutMs: 60000, retryCount: 1, streaming: true };
export function AiSettingsPanel() {
  const [config, setConfig] = useState(empty); const [apiKey, setApiKey] = useState(""); const [masked, setMasked] = useState<string>(); const [show, setShow] = useState(false); const [notice, setNotice] = useState<string>(); const [busy, setBusy] = useState(false); const [databaseReady, setDatabaseReady] = useState(true);
  const load = async () => { const response = await fetch("/api/admin/ai", { cache: "no-store" }); if (!response.ok) return; const payload = await response.json() as { config: Config; key: { masked?: string }; databaseReady: boolean }; setConfig(payload.config); setMasked(payload.key.masked); setDatabaseReady(payload.databaseReady); };
  // Fetching the persisted admin configuration is this effect's external synchronization.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setNotice(undefined); const response = await fetch("/api/admin/ai", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...config, apiKey: apiKey || undefined }) }); const payload = await response.json().catch(() => ({})) as { error?: string }; setBusy(false); setNotice(response.ok ? "AI settings saved securely." : payload.error ?? "Save failed."); if (response.ok) { setApiKey(""); await load(); } };
  const test = async () => { setBusy(true); setNotice("Testing DeepSeek…"); const response = await fetch("/api/admin/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: apiKey || undefined, baseUrl: config.baseUrl, model: config.model || undefined, wireApi: config.wireApi }) }); const payload = await response.json().catch(() => ({})) as { message?: string; latencyMs?: number }; setBusy(false); setNotice(`${payload.message ?? "Connection failed."}${payload.latencyMs ? ` ${payload.latencyMs} ms` : ""}`); };
  const removeKey = async () => { if (!window.confirm("Remove the saved DeepSeek key?")) return; const response = await fetch("/api/admin/ai", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...config, removeApiKey: true }) }); setNotice(response.ok ? "Saved API key removed." : "The key couldn't be removed."); if (response.ok) await load(); };
  return <form onSubmit={save}><Header eyebrow="Model connection" title="DeepSeek AI" description="Configure Cabi's server-only model connection. The API key is encrypted and never returned to this page." />{!databaseReady && <Banner>Connect Supabase before saving settings. Environment variables can still power the chat.</Banner>}<div className="mt-7 grid gap-4 xl:grid-cols-2"><Panel title="Connection"><Field label="Provider"><input disabled value="DeepSeek" className="field opacity-70" /></Field><Field label="API base URL"><input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} className="field" /></Field><Field label="API key" help={masked ? `Saved: ${masked}` : "No saved key"}><div className="relative"><input type={show ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={masked ? "Leave blank to keep current key" : "sk-…"} className="field pr-12" autoComplete="off" /><button type="button" onClick={() => setShow(!show)} className="focus-ring absolute right-1 top-1 grid h-9 w-10 place-items-center rounded-lg text-[var(--cabi-text-muted)] hover:text-white" aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>{masked && <button type="button" onClick={() => void removeKey()} className="focus-ring text-left text-xs text-rose-300">Remove saved key</button>}<Field label="Wire API"><select value={config.wireApi} onChange={(event) => setConfig({ ...config, wireApi: event.target.value as Config["wireApi"] })} className="field"><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select></Field><Field label="Model" help="Leave blank to discover the first available model."><input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} className="field" placeholder="Auto-discover" /></Field></Panel><Panel title="Generation"><Field label={`Temperature · ${config.temperature}`}><input type="range" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })} className="w-full accent-violet-300" /></Field><Field label="Maximum output tokens"><input type="number" min="64" max="32000" value={config.maxOutputTokens} onChange={(event) => setConfig({ ...config, maxOutputTokens: Number(event.target.value) })} className="field" /></Field><Field label="Timeout (milliseconds)"><input type="number" min="5000" max="180000" step="1000" value={config.timeoutMs} onChange={(event) => setConfig({ ...config, timeoutMs: Number(event.target.value) })} className="field" /></Field><Field label="Retries before first token"><input type="number" min="0" max="3" value={config.retryCount} onChange={(event) => setConfig({ ...config, retryCount: Number(event.target.value) })} className="field" /></Field><label className="flex items-center gap-3 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-3 text-sm"><input type="checkbox" checked={config.streaming} onChange={(event) => setConfig({ ...config, streaming: event.target.checked })} className="accent-violet-300" /> Real-time streaming enabled</label></Panel></div><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void test()} disabled={busy} className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-4 text-sm font-semibold hover:bg-[var(--cabi-surface-3)] disabled:opacity-50"><PlugZap size={16} /> Test connection</button><button type="submit" disabled={busy || !databaseReady} className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-[var(--cabi-primary)] px-4 text-sm font-semibold text-[var(--cabi-on-primary)] disabled:opacity-40"><Save size={16} /> Save</button>{notice && <p role="status" className="flex items-center gap-1.5 text-xs text-[var(--cabi-primary)]"><CheckCircle2 size={14} /> {notice}</p>}</div></form>;
}

/**
 * Shared admin panel furniture.
 *
 * These four helpers are imported by every admin screen, which makes them the
 * highest-leverage place in the console: styling them once is what makes fifteen
 * panels agree on a page header, a warning banner, a section card, and a field.
 *
 * They now delegate to the primitives, so the admin console cannot drift from the
 * rest of the product.
 */
export function Header({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <PageHeader overline={eyebrow} title={title} description={description} />;
}

export function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="cabi-inset cabi-surface-warning mt-6 flex items-start gap-2.5 p-4">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--cabi-warning)]" aria-hidden="true" />
      <p className="cabi-body-sm !text-[var(--cabi-warning)]">{children}</p>
    </div>
  );
}

/** A titled block of related controls. One card style across the console. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cabi-card p-5">
      <h2 className="cabi-h3 text-white">{title}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/** A labelled control with optional help text. */
function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="cabi-label">{label}</span>
        {help ? <span className="cabi-caption !text-[10px]">{help}</span> : null}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}