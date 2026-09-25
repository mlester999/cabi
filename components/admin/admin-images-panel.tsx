"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Info,
  LockKeyhole,
  Minus,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge as SharedBadge } from "@/components/ui/cabi-primitives";

import { CabiReferencePanel } from "@/components/admin/cabi-reference-panel";
import { AdminImageErrorsPanel } from "@/components/admin/admin-image-errors-panel";
import {
  IMAGE_PROVIDER_OPTIONS,
  imageModelFor,
  imageModelsForProvider,
  recommendedImageModel,
  type ImageModelDefinition,
  type ImageProviderOption,
} from "@/lib/image-generation/registry";
import type { ImageConnectionDiagnostics } from "@/lib/image-generation/types";
import type { ImagePipelineDebugDetails } from "@/lib/image-generation/pipeline-trace";

type Settings = {
  enabled: boolean;
  provider: string;
  model: string;
  defaultAspectRatio: string;
  defaultQuality: string;
  dailyLimit: number;
  allowGuestGeneration: boolean;
  hasApiKey: boolean;
  keyLastFour: string | null;
  apiKeySource?: "admin" | "environment" | null;
};

type CatalogPayload = {
  settings?: Settings;
  providers?: ImageProviderOption[];
  models?: ImageModelDefinition[];
};

type ConnectionResult = {
  ok: boolean;
  message: string;
  model?: string;
  referenceConditioning?: boolean;
  diagnostics?: ImageConnectionDiagnostics;
};

type FullTestResult = {
  ok: boolean;
  message: string;
  diagnostics?: ImagePipelineDebugDetails;
  referenceConditioned?: boolean;
  referenceFallbackUsed?: boolean;
  promptFallbackUsed?: boolean;
};

type ChatFullTestResult = {
  ok: boolean;
  message: string;
  checks?: Array<{ label: string; state: "PASS" | "FAILED" | "SKIPPED" }>;
  diagnostics?: ImagePipelineDebugDetails;
};

type DiagnosticStepState = "PASS" | "FAILED" | "SKIPPED";

function formatSafeProviderError(error: ImageConnectionDiagnostics["providerError"]): string {
  if (!error) return "No safe provider error details returned.";
  return [
    error.message,
    error.parameter ? `parameter: ${error.parameter}` : null,
    error.code ? `code: ${error.code}` : null,
    error.type ? `type: ${error.type}` : null,
  ].filter((value): value is string => Boolean(value)).join(" · ") || "No safe provider error details returned.";
}

function displayPipelineStage(stage: string | null | undefined): string {
  if (!stage) return "—";
  if (stage === "TOGETHER_RESPONSE_RECEIVED") return "Together Request";
  if (stage === "PROVIDER_IMAGE_FETCHED") return "Image Download";
  if (stage === "SUPABASE_UPLOAD_STARTED" || stage === "SUPABASE_UPLOAD_COMPLETED") return "Supabase Storage";
  return stage.replaceAll("_", " ").toLowerCase().replace(/\b\w/gu, (character) => character.toUpperCase());
}

function formatTogetherRequestShape(shape: NonNullable<ImagePipelineDebugDetails["requestComparison"]>["full"]): string {
  const size = shape.width && shape.height ? `${shape.width}×${shape.height}` : "size omitted";
  return [
    shape.model,
    size,
    `steps ${shape.steps ?? "omitted"}`,
    `seed ${shape.seedPresent ? "included" : "omitted"}`,
    `negative_prompt ${shape.negativePromptPresent ? "included" : "omitted"}`,
    `quality ${shape.qualityPresent ? "included" : "omitted"}`,
    `aspect_ratio ${shape.aspectRatioParameterPresent ? "included" : "omitted"}${shape.aspectRatioInternal ? ` (internal ${shape.aspectRatioInternal})` : ""}`,
    `reference ${shape.referenceInput ?? "none"}`,
    `prompt ${shape.promptLength ?? "?"} chars`,
  ].filter(Boolean).join(" · ");
}

function pipelineCheckState(
  diagnostics: ImagePipelineDebugDetails,
  stage: ImagePipelineDebugDetails["events"][number]["stage"],
): DiagnosticStepState {
  const event = diagnostics.events.find((entry) => entry.stage === stage);
  if (event) return event.error ? "FAILED" : "PASS";
  return diagnostics.stage === stage ? "FAILED" : "SKIPPED";
}

function diagnosticSteps(diagnostics: ImagePipelineDebugDetails) {
  return [
    { label: "Configuration", state: pipelineCheckState(diagnostics, "IMAGE_CONFIG_RESOLVED") },
    { label: "API key", state: pipelineCheckState(diagnostics, "TOGETHER_REQUEST_STARTED") },
    { label: "Prompt", state: pipelineCheckState(diagnostics, "PROMPT_BUILT") },
    { label: "Together request", state: pipelineCheckState(diagnostics, "TOGETHER_RESPONSE_RECEIVED") },
    { label: "Image download", state: pipelineCheckState(diagnostics, "PROVIDER_IMAGE_FETCHED") },
    { label: "Supabase Storage", state: pipelineCheckState(diagnostics, "SUPABASE_UPLOAD_COMPLETED") },
    { label: "Database persistence", state: "SKIPPED" as const },
  ];
}

function diagnosticTone(state: DiagnosticStepState): string {
  if (state === "PASS") return "text-emerald-200";
  if (state === "FAILED") return "text-rose-200";
  return "text-[var(--cabi-text-muted)]";
}

const emptySettings: Settings = {
  enabled: true,
  provider: "together",
  model: "Qwen/Qwen-Image-2.0",
  defaultAspectRatio: "1:1",
  defaultQuality: "standard",
  dailyLimit: 5,
  allowGuestGeneration: false,
  hasApiKey: false,
  keyLastFour: null,
  apiKeySource: null,
};

/**
 * Owner-only image-generation settings.
 *
 * The provider/model catalog comes from the server, while the API key is
 * write-only: it is encrypted server-side and only its last four characters
 * are ever returned to this component.
 */
export function AdminImagesPanel() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [providers, setProviders] = useState<ImageProviderOption[]>([...IMAGE_PROVIDER_OPTIONS]);
  const [models, setModels] = useState<ImageModelDefinition[]>(imageModelsForProvider("together"));
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [fullTest, setFullTest] = useState<FullTestResult | null>(null);
  const [chatFullTest, setChatFullTest] = useState<ChatFullTestResult | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "test-full" | "test-chat-full" | null>(null);

  const applyCatalog = useCallback((payload: CatalogPayload) => {
    const nextProviders = payload.providers?.length ? payload.providers : [...IMAGE_PROVIDER_OPTIONS];
    const nextModels = payload.models?.length ? payload.models : imageModelsForProvider("together");
    const nextSettings = payload.settings ?? emptySettings;
    const provider = nextProviders.some((entry) => entry.id === nextSettings.provider)
      ? nextSettings.provider
      : nextProviders[0]?.id ?? "together";
    const providerModels = nextModels.filter((entry) => entry.provider === provider);
    const model = providerModels.some((entry) => entry.id === nextSettings.model)
      ? nextSettings.model
      : (providerModels.find((entry) => entry.recommended) ?? providerModels[0] ?? recommendedImageModel(provider)).id;

    setProviders(nextProviders);
    setModels(nextModels);
    setSettings({ ...nextSettings, provider, model });
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/images", { cache: "no-store" });
      if (response.ok) applyCatalog(await response.json() as CatalogPayload);
      else setNotice({ tone: "error", message: "Image settings could not be loaded." });
    } catch {
      setNotice({ tone: "error", message: "Image settings could not be loaded." });
    } finally {
      setPhase("ready");
    }
  }, [applyCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedModel = useMemo(
    () => models.find((entry) => entry.id === settings.model && entry.provider === settings.provider)
      ?? imageModelFor(settings.provider, settings.model),
    [models, settings.model, settings.provider],
  );

  const changeProvider = (provider: string) => {
    const nextModels = models.filter((entry) => entry.provider === provider);
    const nextModel = nextModels.find((entry) => entry.recommended) ?? nextModels[0] ?? recommendedImageModel(provider);
    setSettings((current) => ({ ...current, provider, model: nextModel.id }));
    setConnection(null);
    setNotice(null);
  };

  const changeModel = (model: string) => {
    setSettings((current) => ({ ...current, model }));
    setConnection(null);
    setNotice(null);
  };

  const submit = async (action: "save" | "test" | "test-full" | "test-chat-full") => {
    setBusy(action);
    setNotice(null);
    if (action === "test") setConnection(null);
    if (action === "test-full") setFullTest(null);
    if (action === "test-chat-full") setChatFullTest(null);
    const { hasApiKey: _hasApiKey, keyLastFour: _keyLastFour, ...editableSettings } = settings;
    void _hasApiKey;
    void _keyLastFour;
    const body = action === "test-full" || action === "test-chat-full"
      ? { action }
      : action === "test"
      // Testing is a read-only operation: the server resolves the stored key
      // and validates exactly the current selection shown in these controls.
      ? { provider: settings.provider, model: settings.model, action }
      : {
          ...editableSettings,
          action,
          ...(apiKey ? { apiKey } : {}),
          ...(clearApiKey ? { clearApiKey: true } : {}),
        };
    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as CatalogPayload & ConnectionResult & FullTestResult & ChatFullTestResult & { error?: string };
      if (!response.ok) {
        if (action === "test") setConnection({ ok: false, message: payload.message ?? payload.error ?? "Connection failed.", diagnostics: payload.diagnostics });
        if (action === "test-full") setFullTest({ ok: false, message: payload.message ?? payload.error ?? "Full generation failed.", diagnostics: payload.diagnostics });
        if (action === "test-chat-full") setChatFullTest({ ok: false, message: payload.message ?? payload.error ?? "Full chat image test failed.", checks: payload.checks, diagnostics: payload.diagnostics });
        setNotice({ tone: "error", message: payload.message ?? payload.error ?? "That did not work." });
        return;
      }
      if (payload.settings) applyCatalog(payload);
      if (action === "save") {
        setApiKey("");
        setClearApiKey(false);
        setNotice({ tone: "success", message: "Image settings saved." });
      } else if (action === "test") {
        setConnection({
          ok: true,
          message: payload.message ?? "Connected.",
          model: payload.model,
          referenceConditioning: payload.referenceConditioning,
          diagnostics: payload.diagnostics,
        });
        setNotice({ tone: "success", message: "Together AI connection verified." });
      } else if (action === "test-full") {
        setFullTest({
          ok: payload.ok,
          message: payload.message ?? "Full generation verified.",
          diagnostics: payload.diagnostics,
          referenceConditioned: payload.referenceConditioned,
          referenceFallbackUsed: payload.referenceFallbackUsed,
          promptFallbackUsed: payload.promptFallbackUsed,
        });
        setNotice({ tone: "success", message: "Full Cabi generation verified." });
      } else {
        setChatFullTest({ ok: payload.ok, message: payload.message ?? "Full chat image pipeline finished.", checks: payload.checks, diagnostics: payload.diagnostics });
        setNotice({ tone: payload.ok ? "success" : "error", message: payload.ok ? "Full chat image pipeline verified." : "Full chat image pipeline did not pass." });
      }
    } catch {
      const message = "That did not work. Check the connection and try again.";
      if (action === "test") setConnection({ ok: false, message });
      if (action === "test-full") setFullTest({ ok: false, message });
      if (action === "test-chat-full") setChatFullTest({ ok: false, message });
      setNotice({ tone: "error", message });
    } finally {
      setBusy(null);
    }
  };

  if (phase === "loading") return <p className="mt-8 text-sm text-[var(--cabi-text-secondary)]" role="status">Loading image settings...</p>;

  const field = "focus-ring h-11 w-full rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] px-3 text-sm text-white";
  const label = "block text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--cabi-text-muted)]";
  const providerLabel = providers.find((entry) => entry.id === settings.provider)?.label ?? "Together AI";

  return (
    <div className="space-y-5">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border px-3 py-2 text-xs ${notice.tone === "success" ? "border-emerald-300/[0.18] bg-emerald-300/[0.06] text-emerald-100" : notice.tone === "error" ? "border-rose-300/[0.2] bg-rose-300/[0.06] text-rose-100" : "border-violet-200/[0.16] bg-violet-300/[0.06] text-[var(--cabi-text-secondary)]"}`}
        >
          {notice.message}
        </p>
      ) : null}

      <section className="rounded-2xl border border-violet-200/[0.12] bg-[var(--cabi-surface-1)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ImagePlus size={15} className="text-[var(--cabi-primary)]" aria-hidden="true" /> CABI IMAGE GENERATION</h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-5 text-[var(--cabi-text-muted)]">
              Configure Cabi&apos;s dedicated image studio. The selected model, official reference, and generation limits are applied server-side for every image.
            </p>
          </div>
          <span className="rounded-full border border-violet-200/[0.14] bg-violet-300/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--cabi-primary)]">Owner controls</span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3 py-3">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="focus-ring h-4 w-4 accent-violet-400" />
            <span><span className="block text-[13px] font-medium text-white">Enable image generation</span><span className="mt-0.5 block text-[11px] text-[var(--cabi-text-muted)]">Turn the Cabi image studio on for the app.</span></span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3 py-3">
            <input type="checkbox" checked={settings.allowGuestGeneration} onChange={(event) => setSettings({ ...settings, allowGuestGeneration: event.target.checked })} className="focus-ring h-4 w-4 accent-violet-400" />
            <span><span className="block text-[13px] font-medium text-white">Allow guests to generate</span><span className="mt-0.5 block text-[11px] text-[var(--cabi-text-muted)]">Off by default; generation costs are quota-controlled.</span></span>
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Provider</span>
            <span className="relative mt-2 block">
              <select aria-label="Provider" value={settings.provider} onChange={(event) => changeProvider(event.target.value)} className={`${field} appearance-none pr-10`}>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-[var(--cabi-text-muted)]" aria-hidden="true" />
            </span>
            <span className="mt-1.5 block text-[11px] text-[var(--cabi-text-faint)]">{providers.find((entry) => entry.id === settings.provider)?.description ?? "Verified provider catalog."}</span>
          </label>
          <label className="block">
            <span className={label}>Model</span>
            <span className="relative mt-2 block">
              <select aria-label="Model" value={settings.model} onChange={(event) => changeModel(event.target.value)} className={`${field} appearance-none pr-10`}>
                {models.filter((entry) => entry.provider === settings.provider).map((model) => <option key={model.id} value={model.id}>{model.label}{model.badges[0] ? ` · ${model.badges[0]}` : ""}</option>)}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-[var(--cabi-text-muted)]" aria-hidden="true" />
            </span>
            {selectedModel ? (
              <span className="mt-2 block rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3 py-2.5">
                <span className="block text-[12px] font-semibold text-white">{selectedModel.label}</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-[var(--cabi-text-muted)]">{selectedModel.useCase}</span>
                {selectedModel.qualityNote ? <span className="mt-1 block text-[10px] text-[var(--cabi-text-faint)]">{selectedModel.qualityNote}</span> : null}
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {selectedModel.badges.map((badge) => <Badge key={badge} tone={badge === "Recommended" || badge === "Reference Ready" || badge === "Character Consistency" ? "green" : badge === "Highest Quality" ? "amber" : "violet"}>{badge}</Badge>)}
                </span>
                <span className="mt-3 grid gap-1.5 sm:grid-cols-2" aria-label="Model capabilities">
                  <Capability label="Text to Image" supported={selectedModel.supportsTextToImage} />
                  <Capability label="Reference Images" supported={selectedModel.supportsReferenceImages} />
                  <Capability label="Image Editing" supported={selectedModel.supportsImageEditing} />
                  <Capability label="Seed" supported={selectedModel.supportsSeed} />
                  <Capability label="Negative Prompt" supported={selectedModel.supportsNegativePrompt} />
                  <Capability label="Steps" supported={selectedModel.supportsSteps} />
                </span>
                <span className="mt-2 block font-mono text-[10px] text-[var(--cabi-text-faint)]">{selectedModel.id}</span>
              </span>
            ) : null}
          </label>

          <div className="rounded-xl border border-emerald-300/[0.14] bg-emerald-300/[0.04] p-3 sm:col-span-2">
            <div className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
              <div>
                <p className="text-[12px] font-semibold text-emerald-100">Official endpoint and reference are managed automatically</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--cabi-success)]">Together AI uses its verified image endpoint. Cabi&apos;s active reference is attached automatically whenever the selected model supports reference conditioning.</p>
              </div>
            </div>
          </div>

          <label className="block">
            <span className={label}>Default aspect ratio</span>
            <select value={settings.defaultAspectRatio} onChange={(event) => setSettings({ ...settings, defaultAspectRatio: event.target.value })} className={`mt-2 ${field}`}>
              {["1:1", "16:9", "9:16"].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Default quality</span>
            <select value={settings.defaultQuality} onChange={(event) => setSettings({ ...settings, defaultQuality: event.target.value })} className={`mt-2 ${field}`}>
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={label}>Max generations per user / day</span>
            <input type="number" min={1} max={100} value={settings.dailyLimit} onChange={(event) => setSettings({ ...settings, dailyLimit: Number(event.target.value) })} className={`mt-2 max-w-sm ${field}`} />
          </label>
        </div>

        {/* CABI REFERENCE and CABI IDENTITY sit after the model capability report
            and before the API key: the reference is what keeps Cabi recognizable,
            and whether it can be conditioned on is a property of the model just
            selected. */}
        <div className="mt-6 border-t border-[var(--cabi-hairline)] pt-6">
          <CabiReferencePanel selectedProvider={settings.provider} selectedModel={settings.model} selectedModelDefinition={selectedModel} />
        </div>

        <div className="mt-5 border-t border-[var(--cabi-hairline)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={label}>{providerLabel} API Key</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--cabi-text-muted)]"><LockKeyhole size={12} aria-hidden="true" /> Encrypted at rest</span>
          </div>
          {settings.hasApiKey && !clearApiKey ? (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-emerald-200"><CheckCircle2 size={13} aria-hidden="true" /> {settings.apiKeySource === "environment" ? "An environment key is configured" : "A key is stored"}, ending {settings.keyLastFour ?? "----"}</p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--cabi-text-muted)]"><XCircle size={13} aria-hidden="true" /> No key stored</p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
            placeholder={`Paste ${providerLabel} API key`}
            autoComplete="off"
            aria-label={`${providerLabel} API Key`}
            className={`mt-3 ${field}`}
          />
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 text-[var(--cabi-text-faint)]"><Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> Only the last four characters are shown after saving. The key is never returned to the browser or logged.</p>
          {settings.hasApiKey && settings.apiKeySource !== "environment" ? (
            <button type="button" onClick={() => setClearApiKey((current) => !current)} className={`focus-ring mt-2 inline-flex items-center gap-1.5 text-[11px] ${clearApiKey ? "text-emerald-200" : "text-rose-200"}`}>
              <Trash2 size={12} aria-hidden="true" /> {clearApiKey ? "Keep stored key" : "Remove stored key"}
            </button>
          ) : null}
        </div>

        {connection ? (
          <div className={`mt-5 rounded-xl border p-3 ${connection.ok ? "border-emerald-300/[0.18] bg-emerald-300/[0.06]" : "border-rose-300/[0.2] bg-rose-300/[0.06]"}`} role={connection.ok ? "status" : "alert"}>
            <div className="flex items-start gap-2">
              {connection.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-rose-300" aria-hidden="true" />}
              <div>
                <p className={`text-[12px] font-semibold ${connection.ok ? "text-emerald-100" : "text-rose-100"}`}>{connection.ok ? "Connected" : "Connection failed"}</p>
                <p className={`mt-1 text-[11px] leading-5 ${connection.ok ? "text-emerald-100/75" : "text-rose-100/75"}`}>{connection.message}</p>
                {connection.ok ? <p className="mt-2 text-[11px] text-emerald-100/80">Model: {imageModelFor(settings.provider, connection.model ?? settings.model)?.label ?? selectedModel?.label ?? settings.model} · Reference conditioning: {connection.referenceConditioning ? "supported" : "not supported"}</p> : null}
                {connection.diagnostics ? (
                  <details className="mt-3">
                    <summary className="cabi-focus cursor-pointer text-[11px] text-[var(--cabi-text-muted)] transition-colors hover:text-[var(--cabi-text-secondary)]">
                      Advanced details
                    </summary>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-[10px] text-[var(--cabi-text-muted)] sm:grid-cols-2">
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Provider</dt><dd>{connection.diagnostics.provider}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Provider value</dt><dd>{connection.diagnostics.providerReceived ?? "—"} · {connection.diagnostics.providerValid === undefined ? "—" : connection.diagnostics.providerValid ? "valid" : "invalid"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Model value</dt><dd>{connection.diagnostics.modelReceived ?? "—"} · {connection.diagnostics.modelValid === undefined ? "—" : connection.diagnostics.modelValid ? "valid" : "invalid"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Stored key</dt><dd>{connection.diagnostics.storedKeyPresent === undefined ? "—" : connection.diagnostics.storedKeyPresent ? "Yes" : "No"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Key loaded</dt><dd>{connection.diagnostics.keyLoaded ? "Yes" : "No"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Key suffix</dt><dd>{connection.diagnostics.keySuffix ?? "—"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">Request started</dt><dd>{connection.diagnostics.providerRequestStarted === undefined ? "—" : connection.diagnostics.providerRequestStarted ? "Yes" : "No"}</dd></div>
                    <div><dt className="uppercase tracking-[.1em] text-white/35">HTTP status</dt><dd>{connection.diagnostics.httpStatus ?? "—"}</dd></div>
                    {connection.diagnostics.requestShape ? <div className="sm:col-span-2"><dt className="uppercase tracking-[.1em] text-white/35">Probe request</dt><dd className="break-words">{formatTogetherRequestShape(connection.diagnostics.requestShape)}</dd></div> : null}
                    {connection.diagnostics.providerError ? <div className="sm:col-span-2"><dt className="uppercase tracking-[.1em] text-white/35">Provider error</dt><dd className="break-words text-rose-200">{formatSafeProviderError(connection.diagnostics.providerError)}</dd></div> : null}
                    <div className="sm:col-span-2"><dt className="uppercase tracking-[.1em] text-white/35">Endpoint</dt><dd className="break-all">{connection.diagnostics.endpoint}</dd></div>
                    </dl>
                  </details>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {fullTest ? (
          <div className={`mt-5 rounded-xl border p-3 ${fullTest.ok ? "border-emerald-300/[0.18] bg-emerald-300/[0.06]" : "border-rose-300/[0.2] bg-rose-300/[0.06]"}`} role={fullTest.ok ? "status" : "alert"}>
            <div className="flex items-start gap-2">
              {fullTest.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-rose-300" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className={`text-[12px] font-semibold ${fullTest.ok ? "text-emerald-100" : "text-rose-100"}`}>{fullTest.ok ? "Full generation verified" : "Full generation failed"}</p>
                <p className={`mt-1 text-[11px] leading-5 ${fullTest.ok ? "text-emerald-100/75" : "text-rose-100/75"}`}>{fullTest.message}</p>
                {fullTest.ok ? <p className="mt-2 text-[11px] text-emerald-100/80">Reference: {fullTest.referenceConditioned ? "conditioned" : "text only"}{fullTest.referenceFallbackUsed ? " · text-only fallback used" : ""}{fullTest.promptFallbackUsed ? " · clean prompt retry used" : ""}</p> : null}
                {fullTest.diagnostics ? (
                  <div className="mt-3 space-y-3">
                    <section className="rounded-lg border border-white/[0.08] bg-black/15 p-3" aria-label="Generation diagnosis">
                      <p className="text-[11px] font-semibold text-white/85">Generation diagnosis</p>
                      <p className="mt-1 text-[10px] text-[var(--cabi-text-muted)]">
                        HTTP {fullTest.diagnostics.httpStatus ?? "—"} · {fullTest.diagnostics.provider ?? "Provider unknown"} · {imageModelFor("together", fullTest.diagnostics.model ?? settings.model)?.label ?? fullTest.diagnostics.model ?? settings.model}
                        {fullTest.diagnostics.stage ? ` · stopped at ${displayPipelineStage(fullTest.diagnostics.stage)}` : ""}
                      </p>
                      <div className="mt-2 rounded-md bg-black/15 px-2.5 py-2 text-[10px] leading-4">
                        <span className="font-semibold text-white/65">Together response: </span>
                        <span className="break-words text-[var(--cabi-text-secondary)]">{formatSafeProviderError(fullTest.diagnostics.providerError)}</span>
                      </div>
                      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Generation pipeline checks">
                        {diagnosticSteps(fullTest.diagnostics).map((check) => (
                          <li key={check.label} className={`flex items-center justify-between gap-2 text-[10px] ${diagnosticTone(check.state)}`}>
                            <span>{check.label}{check.label === "Database persistence" ? " (not part of this admin test)" : ""}</span>
                            <span className="font-semibold tracking-wide">{check.state}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                    {fullTest.diagnostics.requestComparison ? (
                      <section className="rounded-lg border border-white/[0.08] bg-black/15 p-3" aria-label="Together request comparison">
                        <p className="text-[11px] font-semibold text-white/85">Request comparison</p>
                        <dl className="mt-2 grid gap-2 text-[10px] leading-4 sm:grid-cols-2">
                          <div className="min-w-0"><dt className="text-white/45">Working connection test</dt><dd className="mt-0.5 break-words text-[var(--cabi-text-muted)]">{formatTogetherRequestShape(fullTest.diagnostics.requestComparison.working)}</dd></div>
                          <div className="min-w-0"><dt className="text-white/45">Full Cabi request</dt><dd className="mt-0.5 break-words text-[var(--cabi-text-muted)]">{formatTogetherRequestShape(fullTest.diagnostics.requestComparison.full)}</dd></div>
                          <div><dt className="text-white/45">Only in full request</dt><dd className="mt-0.5 break-words font-mono text-[var(--cabi-text-secondary)]">{fullTest.diagnostics.requestComparison.onlyInFull.join(", ") || "none"}</dd></div>
                          <div><dt className="text-white/45">Only in connection test</dt><dd className="mt-0.5 break-words font-mono text-[var(--cabi-text-secondary)]">{fullTest.diagnostics.requestComparison.onlyInWorking.join(", ") || "none"}</dd></div>
                        </dl>
                      </section>
                    ) : null}
                  </div>
                ) : null}
                {fullTest.diagnostics ? (
                  <details className="mt-3">
                    <summary className="cabi-focus cursor-pointer text-[11px] text-[var(--cabi-text-muted)] transition-colors hover:text-[var(--cabi-text-secondary)]">Debug details</summary>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-[10px] text-[var(--cabi-text-muted)] sm:grid-cols-2">
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Request</dt><dd className="break-all font-mono">{fullTest.diagnostics.requestId}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Stage</dt><dd>{displayPipelineStage(fullTest.diagnostics.stage ?? fullTest.diagnostics.lastStage)}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Error</dt><dd>{fullTest.diagnostics.error ?? "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">HTTP</dt><dd>{fullTest.diagnostics.httpStatus ?? "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Error category</dt><dd>{fullTest.diagnostics.providerErrorCategory ?? "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Prompt hash / length</dt><dd className="font-mono">{fullTest.diagnostics.promptHash ?? "—"} · {fullTest.diagnostics.promptLength ?? "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Model</dt><dd className="break-all">{fullTest.diagnostics.model ?? "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Reference</dt><dd>{fullTest.diagnostics.referenceAttached ? `v${fullTest.diagnostics.referenceVersion ?? "?"} attached` : "text only"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Size</dt><dd>{fullTest.diagnostics.width && fullTest.diagnostics.height ? `${fullTest.diagnostics.width}×${fullTest.diagnostics.height}` : "—"}</dd></div>
                      <div><dt className="uppercase tracking-[.1em] text-white/35">Latency</dt><dd>{fullTest.diagnostics.latencyMs} ms</dd></div>
                    </dl>
                    <ol className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2 text-[10px] text-[var(--cabi-text-muted)]">
                      {fullTest.diagnostics.events.map((event, index) => <li key={`${event.stage}-${index}`} className="flex items-center justify-between gap-2"><span className={event.error ? "text-rose-200" : ""}>{event.stage}{event.error ? ` · ${event.error}` : ""}</span><span className="shrink-0 tabular-nums text-white/35">{event.latencyMs} ms{event.httpStatus ? ` · ${event.httpStatus}` : ""}</span></li>)}
                    </ol>
                  </details>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={busy !== null} onClick={() => void submit("save")} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-violet-300 px-5 text-sm font-bold text-[var(--cabi-on-primary)] disabled:opacity-40">
            <Save size={15} aria-hidden="true" /> {busy === "save" ? "Saving..." : "Save settings"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void submit("test")} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--cabi-border)] px-5 text-sm font-semibold text-[var(--cabi-text-secondary)] disabled:opacity-40">
            <PlugZap size={15} aria-hidden="true" /> {busy === "test" ? "Testing..." : `Test ${providerLabel}`}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void submit("test-full")} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-violet-200/[0.22] bg-violet-300/[0.08] px-5 text-sm font-semibold text-violet-100 disabled:opacity-40">
            <ShieldCheck size={15} aria-hidden="true" /> {busy === "test-full" ? "Running full test..." : "Test Full Cabi Generation"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void submit("test-chat-full")} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-200/[0.2] bg-emerald-300/[0.06] px-5 text-sm font-semibold text-emerald-100 disabled:opacity-40">
            <ShieldCheck size={15} aria-hidden="true" /> {busy === "test-chat-full" ? "Testing chat persistence..." : "Test Full Chat Image Pipeline"}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--cabi-text-muted)]">The chat test makes one real image request using your signed-in wallet, then removes its temporary conversation, generation row, and image.</p>
        {chatFullTest ? (
          <div className={`mt-4 rounded-xl border p-3 ${chatFullTest.ok ? "border-emerald-300/[0.18] bg-emerald-300/[0.06]" : "border-rose-300/[0.2] bg-rose-300/[0.06]"}`} role={chatFullTest.ok ? "status" : "alert"}>
            <p className={`text-[12px] font-semibold ${chatFullTest.ok ? "text-emerald-100" : "text-rose-100"}`}>{chatFullTest.ok ? "Full chat image pipeline verified" : "Full chat image pipeline failed"}</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--cabi-text-secondary)]">{chatFullTest.message}</p>
            {chatFullTest.checks ? (
              <ul className="mt-3 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
                {chatFullTest.checks.map((check) => <li key={check.label} className={check.state === "PASS" ? "text-emerald-200" : check.state === "FAILED" ? "text-rose-200" : "text-[var(--cabi-text-muted)]"}>{check.state === "PASS" ? "✓" : check.state === "FAILED" ? "×" : "–"} {check.label}: {check.state.toLowerCase()}</li>)}
              </ul>
            ) : null}
            {chatFullTest.diagnostics ? <p className="mt-2 text-[10px] text-[var(--cabi-text-muted)]">Request {chatFullTest.diagnostics.requestId} · stopped at {displayPipelineStage(chatFullTest.diagnostics.stage ?? chatFullTest.diagnostics.lastStage)}</p> : null}
          </div>
        ) : null}
      </section>


      <AdminImageErrorsPanel />

      <section className="rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-5">
        <h2 className="text-sm font-bold text-white">Required storage buckets</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--cabi-text-muted)]">Create these private Supabase Storage buckets. Objects are served through short-lived signed URLs.</p>
        <ul className="mt-3 space-y-1.5 font-mono text-[12px] text-[var(--cabi-primary)]"><li>cabi-generations</li><li>avatars</li><li>cabi-system-assets</li></ul>
        <p className="mt-3 text-[11px] leading-5 text-[var(--cabi-text-faint)]"><span className="font-mono text-[var(--cabi-primary)]">cabi-system-assets</span> holds product-owned artwork. The official reference lives at <span className="font-mono">official/cabi-reference.png</span>.</p>
      </section>
    </div>
  );
}

/**
 * A capability badge.
 *
 * Local tones map onto the shared badge contract, so a badge on this screen is
 * shaped, sized, and tracked exactly like a badge anywhere else in the product.
 */
function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "violet" | "amber" | "muted" }) {
  const mapped = tone === "green" ? "success" : tone === "amber" ? "warning" : tone === "violet" ? "primary" : "neutral";
  return <SharedBadge tone={mapped}>{children}</SharedBadge>;
}

function Capability({ label, supported }: { label: string; supported: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] text-[var(--cabi-text-secondary)]"
      data-capability={supported ? "supported" : "unsupported"}
    >
      {supported
        ? <Check size={11} className="shrink-0 text-[var(--cabi-success)]" aria-hidden="true" />
        : <Minus size={11} className="shrink-0 text-[var(--cabi-text-faint)]" aria-hidden="true" />}
      <span>{label}</span>
      <span className="sr-only">{supported ? "supported" : "not supported"}</span>
    </span>
  );
}
