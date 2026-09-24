import { z } from "zod";

import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/db/supabase";
import { createImageProvider } from "@/lib/image-generation/provider";
import {
  IMAGE_PROVIDER_OPTIONS,
  imageModelsForProvider,
  imageProviderFor,
  isImageModelForProvider,
  isSupportedImageProvider,
} from "@/lib/image-generation/registry";
import {
  imageSettingsKey,
  isMaskedImageApiKey,
  parseImageSettings,
  readImageSettings,
  resolveImageGenerationConfig,
  removeImageApiKey,
  writeImageSettings,
} from "@/lib/image-generation/settings";
import { imageDiagnosticErrorCategory, logImageDatabaseFailure, logImageGenerationDiagnostic, safeImageKeySuffix } from "@/lib/image-generation/diagnostics";
import { createImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import { runFullCabiImageTest } from "@/lib/image-generation/full-test";
import type { ImageGenerationSettings } from "@/lib/image-generation/types";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { shortAddress } from "@/lib/wallet-data/types";

export const dynamic = "force-dynamic";

/**
 * The browser can select only catalog entries. In particular, it cannot send a
 * base URL: Together's official endpoint is an adapter invariant.
 */
const imageSelectionFields = {
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(120),
} as const;

const imageAdminPersistSchema = z.object({
  ...imageSelectionFields,
  enabled: z.boolean(),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16"]),
  defaultQuality: z.enum(["standard", "high"]),
  dailyLimit: z.number().int().min(1).max(100),
  allowGuestGeneration: z.boolean(),
  apiKey: z.string().trim().max(400).optional(),
  clearApiKey: z.boolean().optional(),
  action: z.literal("save"),
}).strict();

const imageAdminTestSchema = z.object({
  ...imageSelectionFields,
  action: z.literal("test"),
  // Accept the previous full-form payload during the transition, but none of
  // these values influence a test. The current browser sends only provider and
  // model, so a test always reflects the live controls rather than saved form
  // defaults.
  enabled: z.boolean().optional(),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16"]).optional(),
  defaultQuality: z.enum(["standard", "high"]).optional(),
  dailyLimit: z.number().int().min(1).max(100).optional(),
  allowGuestGeneration: z.boolean().optional(),
  // Kept optional for old clients, but the current browser never sends this
  // field and the server deliberately ignores it for tests.
  apiKey: z.string().trim().max(400).optional(),
}).strict();

const imageAdminFullTestSchema = z.object({
  action: z.literal("test-full"),
}).strict();

function validateImageSelection(value: { provider: string; model: string; apiKey?: string }, context: z.RefinementCtx) {
  if (!isSupportedImageProvider(value.provider)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provider"], message: "Choose a supported image provider." });
  }
  if (!isImageModelForProvider(value.provider, value.model)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Choose a model from the selected provider." });
  }
  if (value.apiKey && isMaskedImageApiKey(value.apiKey)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "Enter a new API key or leave this field blank." });
  }
}

export const imageAdminSaveSchema = z
  .discriminatedUnion("action", [imageAdminPersistSchema, imageAdminTestSchema, imageAdminFullTestSchema])
  .superRefine((value, context) => {
    if (value.action !== "test-full") validateImageSelection(value, context);
  });

type AdminImageSettings = Omit<ImageGenerationSettings, "baseUrl">;

function adminSettings(settings: ImageGenerationSettings): AdminImageSettings {
  const { baseUrl, ...safe } = settings;
  void baseUrl;
  return safe;
}

function catalog() {
  return {
    providers: IMAGE_PROVIDER_OPTIONS,
    models: imageModelsForProvider("together"),
  };
}

function responseHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function safeSelectionValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim().slice(0, 120) || null : null;
}

function selectionDiagnostics(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const providerReceived = safeSelectionValue(raw.provider);
  const modelReceived = safeSelectionValue(raw.model);
  const providerValid = providerReceived !== null && isSupportedImageProvider(providerReceived);
  const modelValid = providerValid && modelReceived !== null && isImageModelForProvider(providerReceived, modelReceived);
  return { providerReceived, providerValid, modelReceived, modelValid };
}

function invalidSelectionResponse(value: unknown) {
  return Response.json({
    error: "Choose a provider and model from the available options.",
    code: "INVALID_INPUT",
    diagnostics: selectionDiagnostics(value),
  }, { status: 400, headers: responseHeaders() });
}

/** Admin image-generation settings. The endpoint and decrypted key stay server-side. */
export async function GET(request: Request) {
  // This is an owner surface, not a public app API. The admin session is the
  // authorization and remains usable during PRELAUNCH/MAINTENANCE.
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  if (new URL(request.url).searchParams.get("section") === "errors") {
    const db = getServiceClient();
    if (!db) return Response.json({ errors: [] }, { headers: responseHeaders() });
    const detailed = await db
      .from("image_generations")
      .select("id,created_at,queued_at,started_at,completed_at,failed_at,status,wallet_account_id,provider,model,failure_code,failure_message,diagnostic_stage,provider_error_category,http_status,pipeline_request_id,prompt_hash,prompt_length,diagnostic_scene,diagnostic_expression,diagnostic_outfit,prompt_retry_count,reference_conditioned")
      .order("created_at", { ascending: false })
      .limit(50);
    let rows = (detailed.data ?? []) as Array<Record<string, unknown>>;
    let activityError = detailed.error;
    let detailedDiagnosticsAvailable = true;
    if (activityError) {
      logImageDatabaseFailure({ requestId: "admin-image-activity", operation: "admin_activity", error: activityError });
      detailedDiagnosticsAvailable = false;
      const fallback = await db
        .from("image_generations")
        .select("id,created_at,status,wallet_account_id,provider,model,failure_code,failure_message")
        .order("created_at", { ascending: false })
        .limit(50);
      rows = (fallback.data ?? []) as Array<Record<string, unknown>>;
      activityError = fallback.error;
    }
    if (activityError) {
      logImageDatabaseFailure({ requestId: "admin-image-activity", operation: "admin_activity", error: activityError });
      return jsonError("Recent generation activity could not be loaded.", 503, "DIAGNOSTICS_UNAVAILABLE");
    }
    const errors = rows.map((record) => {
      const wallet = typeof record.wallet_account_id === "string" ? record.wallet_account_id : "";
      return {
        id: typeof record.id === "string" ? record.id : null,
        time: typeof record.created_at === "string" ? record.created_at : null,
        requestId: typeof record.pipeline_request_id === "string" ? record.pipeline_request_id : null,
        status: typeof record.status === "string" ? record.status : "UNKNOWN",
        user: wallet ? shortAddress(wallet, 8, 4) : "—",
        stage: typeof record.diagnostic_stage === "string" ? record.diagnostic_stage : null,
        provider: typeof record.provider === "string" ? record.provider : null,
        model: typeof record.model === "string" ? record.model : null,
        category: typeof record.provider_error_category === "string" ? record.provider_error_category : record.failure_code,
        httpStatus: typeof record.http_status === "number" ? record.http_status : null,
        details: {
          message: typeof record.failure_message === "string" ? record.failure_message.slice(0, 500) : null,
          promptHash: typeof record.prompt_hash === "string" ? record.prompt_hash : null,
          promptLength: typeof record.prompt_length === "number" ? record.prompt_length : null,
          scene: typeof record.diagnostic_scene === "string" ? record.diagnostic_scene : null,
          expression: typeof record.diagnostic_expression === "string" ? record.diagnostic_expression : null,
          outfit: typeof record.diagnostic_outfit === "string" ? record.diagnostic_outfit : null,
          promptRetryCount: typeof record.prompt_retry_count === "number" ? record.prompt_retry_count : 0,
          referenceConditioned: record.reference_conditioned === true,
        },
      };
    });
    return Response.json({ errors, detailedDiagnosticsAvailable }, { headers: responseHeaders() });
  }

  const settings = await readImageSettings();
  return Response.json({ settings: adminSettings(settings), ...catalog() }, { headers: responseHeaders() });
}

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session;

  const body = await request.json().catch(() => null);
  const parsed = imageAdminSaveSchema.safeParse(body);
  if (!parsed.success) return invalidSelectionResponse(body);
  const { action } = parsed.data;

  if (action === "test") {
    // A saved encrypted key is authoritative. The browser sends only the
    // current provider/model selection; credentials stay server-side. This is
    // the same resolver used by chat, with only the live form selection overlaid.
    const resolved = await resolveImageGenerationConfig({ provider: parsed.data.provider, model: parsed.data.model });
    const candidate = resolved.apiKey;
    const selection = selectionDiagnostics(parsed.data);
    const endpoint = resolved.endpoint;
    if (!candidate) {
      logImageGenerationDiagnostic({
        source: "ADMIN_TEST",
        provider: resolved.provider,
        model: resolved.model,
        endpoint,
        keyPresent: false,
        keySuffix: null,
        keySource: resolved.apiKeySource,
        keyLength: null,
        referenceAttached: false,
        referenceVersion: null,
        referenceInputType: "none",
        width: 512,
        height: 512,
        responseFormat: "url",
        requestStarted: false,
        httpStatus: null,
        providerErrorCategory: "authentication",
        requestFields: ["model", "prompt", "width", "height", "n", "response_format"],
        seedPresent: false,
        negativePromptPresent: false,
        stepsPresent: false,
      });
      return Response.json({
        error: "Add a Together AI API key first.",
        code: "NOT_CONFIGURED",
        diagnostics: {
          ...selection,
          provider: imageProviderFor(parsed.data.provider)?.label ?? "Together AI",
          endpoint,
          keyLoaded: false,
          keySuffix: null,
          storedKeyPresent: resolved.apiKeySource === "admin",
          providerRequestStarted: false,
          httpStatus: null,
        },
      }, { status: 400, headers: responseHeaders() });
    }

    const provider = createImageProvider({
      provider: resolved.provider,
      apiKey: candidate,
      baseUrl: resolved.endpoint,
      model: resolved.model,
      supportsReferenceImage: resolved.capabilities.supportsReferenceImages,
      capabilities: resolved.capabilities,
    });
    const result = await provider.testConnection();
    logImageGenerationDiagnostic({
      source: "ADMIN_TEST",
      provider: resolved.provider,
      model: resolved.model,
      endpoint,
      keyPresent: true,
      keySuffix: safeImageKeySuffix(candidate),
      keySource: resolved.apiKeySource,
      keyLength: candidate.length,
      referenceAttached: false,
      referenceVersion: null,
      referenceInputType: "none",
      width: 512,
      height: 512,
      responseFormat: "url",
      requestStarted: Boolean(result.diagnostics?.providerRequestStarted),
      httpStatus: result.diagnostics?.httpStatus ?? null,
      providerErrorCategory: result.ok
        ? "none"
        : imageDiagnosticErrorCategory({
            httpStatus: result.diagnostics?.httpStatus,
            error: result.error,
            referenceAttached: false,
            providerErrorCategory: result.providerErrorCategory,
          }),
      requestFields: ["model", "prompt", "width", "height", "n", "response_format"],
      seedPresent: false,
      negativePromptPresent: false,
      stepsPresent: false,
    });
    await auditAdmin(request, admin.email, "image_settings.test", "image_settings", "singleton", result.ok ? "success" : "failure", {
      provider: resolved.provider,
      model: resolved.model,
      httpStatus: result.diagnostics?.httpStatus ?? null,
      keySource: resolved.apiKeySource,
    });
    const diagnostics = {
      ...result.diagnostics,
      ...selection,
      provider: result.diagnostics?.provider ?? "Together AI",
      endpoint: result.diagnostics?.endpoint ?? endpoint,
      keyLoaded: result.diagnostics?.keyLoaded ?? true,
      keySuffix: result.diagnostics?.keySuffix ?? safeImageKeySuffix(candidate),
      storedKeyPresent: resolved.apiKeySource === "admin",
      providerRequestStarted: result.diagnostics?.providerRequestStarted ?? false,
      httpStatus: result.diagnostics?.httpStatus ?? null,
    };
    const safeResult = { ...result, diagnostics };
    return Response.json(
      safeResult.ok
        ? { ...safeResult, capabilities: resolved.capabilities, referenceConditioning: resolved.capabilities.supportsReferenceImages }
        : safeResult,
      { status: safeResult.ok ? 200 : 400, headers: responseHeaders() },
    );
  }

  if (action === "test-full") {
    const resolved = await resolveImageGenerationConfig();
    const trace = createImagePipelineTrace({ source: "ADMIN_TEST", aspectRatio: resolved.aspectRatio });
    trace.record("USER_AUTHORIZED");
    trace.record("QUOTA_CHECK_PASSED");
    const result = await runFullCabiImageTest({ config: resolved, trace });
    await auditAdmin(request, admin.email, "image_settings.test_full", "image_settings", "singleton", result.ok ? "success" : "failure", {
      provider: resolved.provider,
      model: resolved.model,
      referenceAttached: result.trace.snapshot().referenceAttached,
      stage: result.trace.snapshot().stage,
      error: result.trace.snapshot().error,
    });
    const snapshot = result.trace.snapshot();
    return Response.json({
      ok: result.ok,
      message: result.message,
      diagnostics: snapshot,
      referenceConditioned: result.ok ? result.referenceConditioned : false,
      referenceFallbackUsed: result.ok ? result.referenceFallbackUsed : false,
      promptFallbackUsed: result.ok ? result.promptFallbackUsed : false,
    }, { status: result.ok ? 200 : 502, headers: responseHeaders() });
  }

  const { apiKey, clearApiKey, ...settings } = parsed.data;

  try {
    // `parseImageSettings` applies the official Together endpoint internally.
    await writeImageSettings(parseImageSettings(settings), admin.email, apiKey || undefined);
    if (clearApiKey && !apiKey) await removeImageApiKey();
  } catch (error) {
    const code = error instanceof Error ? error.message : "SAVE_FAILED";
    if (code === "ENCRYPTION_KEY_NOT_CONFIGURED") return jsonError("APP_ENCRYPTION_KEY is not configured, so the key cannot be stored securely.", 503, code);
    return jsonError("Those settings could not be saved.", 503, "SAVE_FAILED");
  }

  await auditAdmin(request, admin.email, "image_settings.save", "image_settings", "singleton", "success", {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    dailyLimit: settings.dailyLimit,
    // Never the key itself, only whether it changed.
    keyChanged: Boolean(apiKey),
    keyCleared: Boolean(clearApiKey),
  });

  const saved = await readImageSettings();
  return Response.json({ ok: true, settings: adminSettings(saved), ...catalog(), key: imageSettingsKey }, { headers: responseHeaders() });
}
