import "server-only";

import { aspectRatioSizes } from "@/lib/image-generation/types";
import { createImageProvider } from "@/lib/image-generation/provider";
import { executeImageGeneration, type ImageGenerationExecutionResult } from "@/lib/image-generation/execute";
import type { ResolvedImageGenerationConfig } from "@/lib/image-generation/settings";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import type { CabiGenerationPlan } from "@/lib/image-generation/plan.server";
import type { ImagePipelineSource, ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import { imagePromptHash } from "@/lib/image-generation/diagnostics";

export type CabiImagePipelineFailure = {
  ok: false;
  error: string;
  message: string;
  generated?: ImageGenerationExecutionResult;
  /** Set when an upload succeeded but the signed URL step failed. */
  path?: string;
};

export type CabiImagePipelineSuccess = {
  ok: true;
  generationId: string;
  plan: CabiGenerationPlan;
  generated: Extract<ImageGenerationExecutionResult, { ok: true }>;
  uploaded: { path: string };
  url: string;
};

export type CabiImagePipelineResult = CabiImagePipelineSuccess | CabiImagePipelineFailure;

/** Keeps the plan-stage diagnostics identical for chat, HTTP, and admin tests. */
export function recordCabiPlanStages(trace: ImagePipelineTrace, config: ResolvedImageGenerationConfig, plan: CabiGenerationPlan) {
  const size = aspectRatioSizes[plan.aspectRatio];
  trace.record("CABI_REFERENCE_RESOLVED", {
    referenceVersion: plan.reference.version,
    referenceAttached: Boolean(plan.referenceImages?.length),
  });
  trace.record("PROMPT_BUILT", {
    provider: config.provider,
    model: config.model,
    aspectRatio: plan.aspectRatio,
    width: size.width,
    height: size.height,
    promptHash: imagePromptHash(plan.prompt),
    promptLength: plan.prompt.length,
    scene: plan.scene,
    expression: plan.expression,
    outfit: plan.outfit,
  });
}

/**
 * Canonical provider → image download → private bucket → signed URL pipeline.
 * Chat owns quota, lifecycle rows, and message persistence; this function owns
 * the expensive image path so the admin full test cannot drift from real chat.
 */
export async function runCabiImagePipeline(input: {
  config: ResolvedImageGenerationConfig;
  plan: CabiGenerationPlan;
  source: ImagePipelineSource;
  trace: ImagePipelineTrace;
  walletAccountId: string;
  generationId: string;
}): Promise<CabiImagePipelineResult> {
  const provider = createImageProvider({
    provider: input.config.provider,
    apiKey: input.config.apiKey ?? "",
    baseUrl: input.config.endpoint,
    model: input.config.model,
    supportsReferenceImage: input.config.capabilities.supportsReferenceImages,
    capabilities: input.config.capabilities,
  });
  let generated: ImageGenerationExecutionResult;
  try {
    generated = await executeImageGeneration({
      source: input.source,
      config: input.config,
      provider,
      referenceVersion: input.plan.reference.version,
      minimalPrompt: input.plan.minimalPrompt,
      request: {
        scene: input.plan.scene,
        aspectRatio: input.plan.aspectRatio,
        quality: input.config.quality,
        seed: input.plan.seed ?? undefined,
        negativePrompt: input.plan.negative,
        referenceImages: input.plan.referenceImages,
        preparedPrompt: input.plan.prompt,
      },
      trace: input.trace,
    });
  } catch {
    input.trace.record("TOGETHER_RESPONSE_RECEIVED", { error: "UNEXPECTED_PROVIDER_ERROR" });
    return { ok: false, error: "PROVIDER_ERROR", message: "I could not reach the image service." };
  }

  if (!generated.ok) {
    return {
      ok: false,
      error: generated.error,
      message: generated.message,
      generated,
    };
  }

  input.trace.record("SUPABASE_UPLOAD_STARTED");
  let uploaded: Awaited<ReturnType<typeof uploadGenerationImage>>;
  try {
    uploaded = await uploadGenerationImage({
      walletAccountId: input.walletAccountId,
      generationId: input.generationId,
      bytes: generated.image.bytes,
      contentType: generated.image.contentType,
    });
  } catch {
    input.trace.record("SUPABASE_UPLOAD_COMPLETED", { error: "STORAGE_UPLOAD_FAILED" });
    return { ok: false, error: "STORAGE_FAILED", message: "Cabi couldn't save that image." };
  }
  if (!uploaded.ok) {
    input.trace.record("SUPABASE_UPLOAD_COMPLETED", { error: "STORAGE_UPLOAD_FAILED" });
    return { ok: false, error: "STORAGE_FAILED", message: uploaded.message };
  }
  input.trace.record("SUPABASE_UPLOAD_COMPLETED");

  let url: string | null = null;
  try {
    url = await signedImageUrl(generationBucket, uploaded.path, 600);
  } catch {
    url = null;
  }
  if (!url) {
    // The object exists, but the user cannot render it without a signed link;
    // keep the first failing stage visible to owner diagnostics and let the
    // caller clean up the temporary object.
    input.trace.record("SUPABASE_UPLOAD_COMPLETED", { error: "SIGNED_URL_FAILED" });
    return {
      ok: false,
      error: "SIGNED_URL_FAILED",
      message: "The image uploaded, but its signed link could not be created.",
      path: uploaded.path,
    };
  }

  return { ok: true, generationId: input.generationId, plan: input.plan, generated, uploaded, url };
}
