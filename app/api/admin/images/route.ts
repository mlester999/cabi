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
import { runFullChatImageTest } from "@/lib/image-generation/full-chat-test";
import type { ImageGenerationSettings } from "@/lib/image-generation/types";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { shortAddress } from "@/lib/wallet-data/types";
import { readWalletAuth } from "@/lib/wallet/session";

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
  provider: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  action: z.literal("test-full"),
}).strict();

const imageAdminFullChatTestSchema = z.object({
  action: z.literal("test-chat-full"),
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
  .discriminatedUnion("action", [imageAdminPersistSchema, imageAdminTestSchema, imageAdminFullTestSchema, imageAdminFullChatTestSchema])
  .superRefine((value, context) => {
    if (value.action !== "test-full" && value.action !== "test-chat-full") validateImageSelection(value, context);
    if (value.action === "test-full") {
      if ((value.provider === undefined) !== (value.model === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Choose a provider and model together." });
      } else if (value.provider !== undefined && value.model !== undefined) {
        validateImageSelection({ provider: value.provider, model: value.model }, context);
      }
    }
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

function safeDatabaseDiagnostic(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const table = raw.table === "image_generations" || raw.table === "messages" || raw.table === "conversations" || raw.table === "profiles" ? raw.table : null;
  const code = typeof raw.code === "string" && (/^[0-9A-Z]{5}$/u.test(raw.code) || /^PGRST\d{3}$/u.test(raw.code)) ? raw.code : null;
  const identifier = (candidate: unknown) => typeof candidate === "string" && /^[A-Za-z_][A-Za-z0-9_$-]{0,127}$/u.test(candidate) ? candidate : null;
  const allowedReasons = new Set([
    "missing_column", "missing_column_or_schema_cache", "missing_table", "missing_table_or_schema_cache",
    "not_null_violation", "foreign_key_violation", "unique_violation", "check_violation", "permission_denied",
    "database_write_failed", "no_row_updated", "database_not_configured",
  ]);
  return {
    code,
    table,
    reason: typeof raw.reason === "string" && allowedReasons.has(raw.reason) ? raw.reason : "database_write_failed",
    column: identifier(raw.column),
    constraint: identifier(raw.constraint),
  };
}

function auditEventId(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  return typeof value === "number" && Number.isInteger(value) ? String(value) : null;
}

function databaseOperationStage(value: unknown): string {
  switch (value) {
    case "insert": return "GENERATION_ROW_CREATED";
    case "mark_generating":
    case "mark_completed":
    case "mark_failed": return "GENERATION_ROW_UPDATED";
    case "link_message": return "CHAT_IMAGE_MESSAGE_CREATED";
    case "chat_message_create": return "CHAT_MESSAGE_CREATED";
    case "chat_message": return "CHAT_MESSAGE_PERSISTED";
    case "chat_conversation": return "CHAT_MESSAGE_CREATED";
    case "chat_profile": return "USER_AUTHORIZED";
    default: return "DATABASE_PERSISTENCE";
  }
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
    let diagnosticEvents: Array<Record<string, unknown>> = [];
    const diagnosticRead = await db.from("audit_logs")
      .select("id,occurred_at,request_id,actor_id,target_type,target_id,metadata_json")
      .in("action", ["image_generation.database_failure", "chat.persistence_failure"])
      .eq("outcome", "failure")
      .order("occurred_at", { ascending: false })
      .limit(50);
    if (diagnosticRead.error) {
      detailedDiagnosticsAvailable = false;
      logImageDatabaseFailure({ requestId: "admin-image-database-diagnostics", operation: "admin_activity", error: diagnosticRead.error });
    } else {
      diagnosticEvents = (diagnosticRead.data ?? []) as Array<Record<string, unknown>>;
    }
    const matchedEvents = new Set<string>();
    const errors = rows.map((record) => {
      const wallet = typeof record.wallet_account_id === "string" ? record.wallet_account_id : "";
      const id = typeof record.id === "string" ? record.id : null;
      const requestId = typeof record.pipeline_request_id === "string" ? record.pipeline_request_id : null;
      const event = diagnosticEvents.find((candidate) => {
        const metadata = candidate.metadata_json && typeof candidate.metadata_json === "object" ? candidate.metadata_json as Record<string, unknown> : {};
        const candidateRequestId = typeof candidate.request_id === "string" ? candidate.request_id : typeof metadata.requestId === "string" ? metadata.requestId : null;
        const targetId = typeof candidate.target_id === "string" ? candidate.target_id : null;
        return (id && targetId === id) || (requestId && candidateRequestId === requestId);
      });
      const matchedEventId = event ? auditEventId(event.id) : null;
      if (matchedEventId) matchedEvents.add(matchedEventId);
      const eventMetadata = event?.metadata_json && typeof event.metadata_json === "object" ? event.metadata_json as Record<string, unknown> : {};
      const database = event ? safeDatabaseDiagnostic(eventMetadata.database) : null;
      return {
        id,
        time: typeof record.created_at === "string" ? record.created_at : null,
        requestId: requestId ?? (event && typeof event.request_id === "string" ? event.request_id : null),
        status: typeof record.status === "string" ? record.status : "UNKNOWN",
        user: wallet ? shortAddress(wallet, 8, 4) : "—",
        stage: typeof record.diagnostic_stage === "string" ? record.diagnostic_stage : event ? databaseOperationStage(eventMetadata.operation) : null,
        provider: typeof record.provider === "string" ? record.provider : null,
        model: typeof record.model === "string" ? record.model : null,
        category: typeof record.provider_error_category === "string" ? record.provider_error_category : record.failure_code,
        httpStatus: typeof record.http_status === "number" ? record.http_status : null,
        database,
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
    for (const event of diagnosticEvents) {
      const eventId = auditEventId(event.id);
      if (eventId && matchedEvents.has(eventId)) continue;
      const metadata = event.metadata_json && typeof event.metadata_json === "object" ? event.metadata_json as Record<string, unknown> : {};
      const wallet = typeof metadata.walletAccountId === "string" ? metadata.walletAccountId : typeof event.actor_id === "string" ? event.actor_id : "";
      errors.push({
        id: eventId ? `db-${eventId}` : null,
        time: typeof event.occurred_at === "string" ? event.occurred_at : null,
        requestId: typeof event.request_id === "string" ? event.request_id : null,
        status: "FAILED",
        user: wallet ? shortAddress(wallet, 8, 4) : "—",
        stage: databaseOperationStage(metadata.operation),
        provider: null,
        model: null,
        category: "database_write_failed",
        httpStatus: null,
        database: safeDatabaseDiagnostic(metadata.database),
        details: { message: null, promptHash: null, promptLength: null, scene: null, expression: null, outfit: null, promptRetryCount: 0, referenceConditioned: false },
      });
    }
    errors.sort((a, b) => Date.parse(String(b.time ?? "")) - Date.parse(String(a.time ?? "")));
    return Response.json({ errors: errors.slice(0, 50), detailedDiagnosticsAvailable }, { headers: responseHeaders() });
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
    const resolved = await resolveImageGenerationConfig(
      parsed.data.provider && parsed.data.model ? { provider: parsed.data.provider, model: parsed.data.model } : undefined,
    );
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
      previewDataUrl: result.ok ? result.previewDataUrl : null,
    }, { status: result.ok ? 200 : 502, headers: responseHeaders() });
  }

  if (action === "test-chat-full") {
    let identity: Awaited<ReturnType<typeof readWalletAuth>>;
    try {
      identity = await readWalletAuth();
    } catch {
      return jsonError("Wallet sign-in is temporarily unavailable.", 503, "WALLET_AUTH_UNAVAILABLE");
    }
    if (!identity) return jsonError("Connect and sign in with your wallet before running the chat test.", 401, "WALLET_REQUIRED");

    const result = await runFullChatImageTest({
      walletAccountId: identity.walletAccountId,
      profileId: identity.profileId,
    });
    await auditAdmin(request, admin.email, "image_settings.test_chat_full", "image_settings", "singleton", result.ok ? "success" : "failure", {
      requestId: result.diagnostics.requestId,
      stage: result.diagnostics.stage ?? result.diagnostics.lastStage,
      checks: result.checks,
    });
    return Response.json(result, { status: result.ok ? 200 : 502, headers: responseHeaders() });
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
