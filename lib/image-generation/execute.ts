import "server-only";

import { aspectRatioSizes } from "@/lib/image-generation/types";
import type {
  ImageGenerationResult,
} from "@/lib/image-generation/types";
import type { ImageGenerationProvider, ImageGenerationRequest } from "@/lib/image-generation/provider";
import type { ResolvedImageGenerationConfig } from "@/lib/image-generation/settings";
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
};

function diagnosticFor(input: {
  source: "CHAT_GENERATION" | "HTTP_GENERATION";
  config: ResolvedImageGenerationConfig;
  request: ImageGenerationRequest;
  referenceVersion: number | null;
  result: ImageGenerationResult;
}): void {
  const reference = input.request.referenceImages?.[0];
  const size = aspectRatioSizes[input.request.aspectRatio];
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
    providerErrorCategory: input.result.ok
      ? "none"
      : imageDiagnosticErrorCategory({
          httpStatus: input.result.httpStatus,
          error: input.result.error,
          referenceAttached: Boolean(reference),
        }),
  });
}

/**
 * Executes one generation and applies the only permitted fallback:
 * a reference-bearing Together request that receives HTTP 403 gets one
 * text-only retry. Auth, billing, rate-limit, timeout, and outage responses do
 * not enter this branch. A text-only success proves the reference input was the
 * rejected part; a second failure is returned unchanged.
 */
export async function executeImageGeneration(input: {
  source: "CHAT_GENERATION" | "HTTP_GENERATION";
  config: ResolvedImageGenerationConfig;
  provider: ImageGenerationProvider;
  request: ImageGenerationRequest;
  referenceVersion: number | null;
}): Promise<ImageGenerationExecutionResult> {
  const first = await input.provider.generateCabiImage(input.request);
  diagnosticFor({ ...input, result: first });
  const firstWithMetadata = {
    ...first,
    referenceConditioned: Boolean(input.request.referenceImages?.length),
    referenceFallbackUsed: false,
  } as ImageGenerationExecutionResult;

  if (
    first.ok
    || !input.request.referenceImages?.length
    || first.httpStatus !== 403
  ) {
    return firstWithMetadata;
  }

  const fallbackRequest = { ...input.request, referenceImages: undefined };
  const fallback = await input.provider.generateCabiImage(fallbackRequest);
  diagnosticFor({ ...input, request: fallbackRequest, result: fallback });
  return {
    ...fallback,
    referenceConditioned: false,
    referenceFallbackUsed: true,
  } as ImageGenerationExecutionResult;
}
