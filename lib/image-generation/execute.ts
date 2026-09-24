import "server-only";

import { aspectRatioSizes } from "@/lib/image-generation/types";
import type {
  ImageGenerationResult,
} from "@/lib/image-generation/types";
import type { ImageGenerationProvider, ImageGenerationRequest } from "@/lib/image-generation/provider";
import type { ResolvedImageGenerationConfig } from "@/lib/image-generation/settings";
import type { ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import {
  imageDiagnosticErrorCategory,
  imageReferenceInputType,
  logImageGenerationDiagnostic,
  safeImageKeySuffix,
} from "@/lib/image-generation/diagnostics";

export type ImageGenerationExecutionResult = ImageGenerationResult & {
  /** True only for the request that actually carried a reference image. */
  referenceConditioned: boolean;
  /** True when a reference 403 was proven to be reference-specific by a successful text-only retry. */
  referenceFallbackUsed: boolean;
  /** True when the one permitted UNSAFE_PROMPT retry used the minimal prompt. */
  promptFallbackUsed: boolean;
};

function diagnosticFor(input: {
  source: "ADMIN_TEST" | "CHAT_GENERATION" | "HTTP_GENERATION";
  config: ResolvedImageGenerationConfig;
  request: ImageGenerationRequest;
  referenceVersion: number | null;
  result: ImageGenerationResult;
}): void {
  const reference = input.request.referenceImages?.[0];
  const size = aspectRatioSizes[input.request.aspectRatio];
  const providerErrorCategory = input.result.ok
    ? "none"
    : imageDiagnosticErrorCategory({
        httpStatus: input.result.httpStatus,
        error: input.result.error,
        referenceAttached: Boolean(reference),
        providerErrorCategory: input.result.providerErrorCategory,
      });
  input.request.trace?.update({ providerErrorCategory });
  logImageGenerationDiagnostic({
    source: input.source,
    provider: input.config.provider,
    model: input.config.model,
    endpoint: input.config.endpoint,
    keyPresent: Boolean(input.config.apiKey),
    keySuffix: safeImageKeySuffix(input.config.apiKey),
    referenceAttached: Boolean(reference),
    referenceVersion: input.referenceVersion,
    referenceInputType: imageReferenceInputType(reference),
    width: size.width,
    height: size.height,
    responseFormat: "url",
    requestStarted: true,
    httpStatus: input.result.ok ? null : input.result.httpStatus ?? null,
    providerErrorCategory,
  });
}

/**
 * Executes one generation and applies the only permitted fallback:
 * a reference-bearing Together request that is explicitly classified as a
 * reference-input failure gets one text-only retry. Auth, billing, rate-limit,
 * timeout, outage, and generic permission responses do not enter this branch. A
 * text-only success proves the reference input was the rejected part; a second
 * failure is returned unchanged.
 */
export async function executeImageGeneration(input: {
  source: "ADMIN_TEST" | "CHAT_GENERATION" | "HTTP_GENERATION";
  config: ResolvedImageGenerationConfig;
  provider: ImageGenerationProvider;
  request: ImageGenerationRequest;
  referenceVersion: number | null;
  /** Positive-only retry prompt built by the server-side Cabi plan. */
  minimalPrompt?: string;
  trace?: ImagePipelineTrace;
}): Promise<ImageGenerationExecutionResult> {
  const request = input.trace ? { ...input.request, trace: input.trace } : input.request;
  const first = await input.provider.generateCabiImage(request);
  diagnosticFor({ ...input, request, result: first });
  const firstWithMetadata = {
    ...first,
    referenceConditioned: Boolean(request.referenceImages?.length),
    referenceFallbackUsed: false,
    promptFallbackUsed: false,
  } as ImageGenerationExecutionResult;

  if (first.ok) return firstWithMetadata;

  // Together may classify a harmless assembled prompt as UNSAFE_PROMPT. The
  // application safety gate has already passed, so make one clean positive
  // retry. It is never a moderation bypass and it is never repeated.
  if (first.error === "UNSAFE_PROMPT" && input.minimalPrompt?.trim()) {
    const fallbackRequest = {
      ...request,
      preparedPrompt: input.minimalPrompt,
      negativePrompt: undefined,
    };
    input.trace?.update({ retryCount: 1 });
    const fallback = await input.provider.generateCabiImage(fallbackRequest);
    diagnosticFor({ ...input, request: fallbackRequest, result: fallback });
    return {
      ...fallback,
      referenceConditioned: Boolean(fallbackRequest.referenceImages?.length),
      referenceFallbackUsed: false,
      promptFallbackUsed: true,
    } as ImageGenerationExecutionResult;
  }

  if (!request.referenceImages?.length || first.providerErrorCategory !== "reference_input") {
    return firstWithMetadata;
  }

  const fallbackRequest = { ...request, referenceImages: undefined };
  input.trace?.update({ retryCount: 1 });
  const fallback = await input.provider.generateCabiImage(fallbackRequest);
  diagnosticFor({ ...input, request: fallbackRequest, result: fallback });
  return {
    ...fallback,
    referenceConditioned: false,
    referenceFallbackUsed: true,
    promptFallbackUsed: false,
  } as ImageGenerationExecutionResult;
}
