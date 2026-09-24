import "server-only";

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
  referenceAttached: boolean;
  referenceVersion: number | null;
  referenceInputType: ImageReferenceInputType;
  width: number;
  height: number;
  responseFormat: "url" | "base64";
  requestStarted: boolean;
  httpStatus: number | null;
  providerErrorCategory: ImageProviderErrorCategory;
};

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
  if (status === 400 || status === 422 || input.error === "UNSAFE_PROMPT") return "unsafe_prompt";
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
  console.info("[cabi:image-diagnostic]", JSON.stringify(diagnostic));
}

/** Logs the complete safe trace without prompts, URLs, response bodies, or keys. */
export function logImagePipelineTrace(trace: ImagePipelineTrace | ImagePipelineDebugDetails): void {
  if (!envBoolean("IMAGE_GENERATION_DIAGNOSTICS")) return;
  const snapshot = "snapshot" in trace ? trace.snapshot() : trace;
  console.info("[cabi:image-pipeline]", JSON.stringify(snapshot));
}
