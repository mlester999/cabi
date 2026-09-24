import "server-only";

import { createHash } from "node:crypto";

import { envBoolean } from "@/lib/config/env";
import type {
  ImageGenerationError,
  ImageProviderErrorCategory,
} from "@/lib/image-generation/types";
import type { ImagePipelineDebugDetails, ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";

export type ImageDiagnosticSource = "ADMIN_TEST" | "CHAT_GENERATION" | "HTTP_GENERATION";
export type ImageReferenceInputType = "none" | "https-url" | "http-url" | "data-url" | "other";

export type ImageGenerationDiagnostic = {
  source: ImageDiagnosticSource;
  provider: string;
  model: string;
  endpoint: string;
  keyPresent: boolean;
  keySuffix: string | null;
  keySource?: "admin" | "environment" | null;
  keyLength?: number | null;
  referenceAttached: boolean;
  referenceVersion: number | null;
  referenceInputType: ImageReferenceInputType;
  width: number;
  height: number;
  responseFormat: "url" | "base64";
  requestStarted: boolean;
  httpStatus: number | null;
  providerErrorCategory: ImageProviderErrorCategory;
  /** Field names only; never include a prompt or reference URL here. */
  requestFields?: string[];
  seedPresent?: boolean;
  negativePromptPresent?: boolean;
  stepsPresent?: boolean;
};

export type ImageDatabaseOperation = "insert" | "mark_generating" | "mark_completed" | "mark_failed" | "link_message" | "admin_activity";

export type SafeImageDatabaseError = {
  code: string | null;
  table: "image_generations";
  constraint: string | null;
  column: string | null;
  reason: string;
};

const databaseReasons: Record<string, string> = {
  "42703": "missing_column",
  PGRST204: "missing_column_or_schema_cache",
  "42P01": "missing_table",
  PGRST205: "missing_table_or_schema_cache",
  "23502": "not_null_violation",
  "23503": "foreign_key_violation",
  "23505": "unique_violation",
  "23514": "check_violation",
  "42501": "permission_denied",
};

function databaseIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const identifier = value.trim().replace(/^['"]|['"]$/gu, "");
  return /^[A-Za-z_][A-Za-z0-9_$-]{0,127}$/u.test(identifier) ? identifier : null;
}

/** Extracts only structured, low-risk database identifiers and allowlisted codes. */
export function sanitizeImageDatabaseError(error: unknown): SafeImageDatabaseError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
  const code = /^[0-9A-Z]{5}$/u.test(rawCode) || /^PGRST\d{3}$/u.test(rawCode) ? rawCode : null;
  const safeText = [record.message, record.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .slice(0, 2_000);
  const schemaCacheColumn = safeText.match(/could not find the ['"]([^'"]+)['"] column of ['"]image_generations['"] in the schema cache/iu)?.[1];
  const postgresColumn = safeText.match(/\bcolumn\s+(?:"([^"\r\n]+)"|([A-Za-z_][A-Za-z0-9_$]*))(?:\s+of\s+(?:relation|table)\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][A-Za-z0-9_$.]*))?\s+does not exist\b/iu);
  const constraintFromMessage = safeText.match(/\bconstraint\s+["']([^"']+)["']/iu)?.[1];
  const constraint = databaseIdentifier(record.constraint) ?? databaseIdentifier(constraintFromMessage);
  const column = databaseIdentifier(schemaCacheColumn) ?? databaseIdentifier(postgresColumn?.[1] ?? postgresColumn?.[2]);

  return {
    code,
    table: "image_generations",
    constraint,
    column,
    reason: code ? databaseReasons[code] ?? "database_write_failed" : "database_write_failed",
  };
}

/** Emits safe write diagnostics only when explicitly enabled; raw DB errors never leave this function. */
export function logImageDatabaseFailure(input: {
  requestId: string;
  operation: ImageDatabaseOperation;
  error?: unknown;
  reason?: "no_row_updated" | "database_not_configured";
}): void {
  if (!envBoolean("IMAGE_GENERATION_DIAGNOSTICS")) return;
  const safe = input.reason
    ? { code: null, table: "image_generations" as const, constraint: null, column: null, reason: input.reason }
    : sanitizeImageDatabaseError(input.error);
  console.error("[cabi:image-database-error]", JSON.stringify({ requestId: input.requestId, operation: input.operation, ...safe }));
}

/** Safe last-four metadata; the full credential never enters a diagnostic. */
export function safeImageKeySuffix(apiKey: string | null | undefined): string | null {
  return apiKey ? apiKey.slice(-4) : null;
}

export function imageReferenceInputType(value: string | undefined): ImageReferenceInputType {
  if (!value) return "none";
  if (value.startsWith("data:")) return "data-url";
  if (value.startsWith("https://")) return "https-url";
  if (value.startsWith("http://")) return "http-url";
  return "other";
}

/** Stable short fingerprint for correlating a failure without storing a prompt. */
export function imagePromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/**
 * Categorises status/error metadata without copying provider response text.
 * A 403 with a reference is labelled as a reference-input candidate only for
 * diagnostics; the execution wrapper confirms it by retrying text-only and
 * only treats that retry's success as a real fallback.
 */
export function imageDiagnosticErrorCategory(input: {
  httpStatus?: number | null;
  error?: ImageGenerationError;
  referenceAttached?: boolean;
  providerErrorCategory?: ImageProviderErrorCategory;
}): ImageProviderErrorCategory {
  if (input.providerErrorCategory && input.providerErrorCategory !== "none") return input.providerErrorCategory;
  const status = input.httpStatus ?? null;
  if (status === 401 || input.error === "NOT_CONFIGURED") return "authentication";
  if (status === 402) return "billing";
  if (status === 429 || input.error === "RATE_LIMITED") return "rate_limit";
  if (status === 403 && input.referenceAttached) return "reference_input";
  if (status === 403) return "provider_error";
  if (status === 404) return "model_or_endpoint";
  if (input.error === "UNSAFE_PROMPT") return "unsafe_prompt";
  if (status !== null && status >= 500) return "provider_outage";
  if (input.error === "TIMEOUT") return "timeout";
  if (input.error) return "provider_error";
  return "none";
}

/**
 * Opt-in diagnostics for comparing admin and chat requests. The record is safe
 * by construction: no prompt, signed URL, response body, request id, or key is
 * included. Enable temporarily with IMAGE_GENERATION_DIAGNOSTICS=1.
 */
export function logImageGenerationDiagnostic(diagnostic: ImageGenerationDiagnostic): void {
  if (!envBoolean("IMAGE_GENERATION_DIAGNOSTICS")) return;
  const allowedRequestFields = new Set(["model", "prompt", "n", "response_format", "width", "height", "steps", "seed", "negative_prompt", "image_url", "reference_images"]);
  const safeDiagnostic = {
    ...diagnostic,
    keyLength: Number.isInteger(diagnostic.keyLength) && (diagnostic.keyLength ?? -1) >= 0 ? diagnostic.keyLength : null,
    requestFields: diagnostic.requestFields?.filter((field) => allowedRequestFields.has(field)),
  };
  console.info("[cabi:image-diagnostic]", JSON.stringify(safeDiagnostic));
}

/** Logs the complete safe trace without prompts, URLs, response bodies, or keys. */
export function logImagePipelineTrace(trace: ImagePipelineTrace | ImagePipelineDebugDetails): void {
  if (!envBoolean("IMAGE_GENERATION_DIAGNOSTICS")) return;
  const snapshot = "snapshot" in trace ? trace.snapshot() : trace;
  console.info("[cabi:image-pipeline]", JSON.stringify(snapshot));
}

/** Safe columns for the owner diagnostics view; never includes the prompt. */
export function imagePipelineDatabaseFields(trace: ImagePipelineTrace | ImagePipelineDebugDetails) {
  const snapshot = "snapshot" in trace ? trace.snapshot() : trace;
  return {
    pipeline_request_id: snapshot.requestId,
    diagnostic_stage: snapshot.stage ?? snapshot.lastStage,
    provider_error_category: snapshot.providerErrorCategory,
    http_status: snapshot.httpStatus,
    prompt_hash: snapshot.promptHash,
    prompt_length: snapshot.promptLength,
    diagnostic_scene: snapshot.scene,
    diagnostic_expression: snapshot.expression,
    diagnostic_outfit: snapshot.outfit,
    prompt_retry_count: snapshot.retryCount,
  };
}
