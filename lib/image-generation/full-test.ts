import "server-only";

import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { aspectRatioSizes } from "@/lib/image-generation/types";
import { deleteGenerationImage } from "@/lib/image-generation/storage";
import type { ResolvedImageGenerationConfig } from "@/lib/image-generation/settings";
import { logImagePipelineTrace } from "@/lib/image-generation/diagnostics";
import { createImagePipelineTrace, type ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import { recordCabiPlanStages, runCabiImagePipeline } from "@/lib/image-generation/pipeline";

export type FullCabiImageTestResult =
  | {
      ok: true;
      message: string;
      trace: ImagePipelineTrace;
      referenceConditioned: boolean;
      referenceFallbackUsed: boolean;
      promptFallbackUsed: boolean;
    }
  | { ok: false; message: string; trace: ImagePipelineTrace };

/**
 * Runs the real Cabi generation and private-storage path without creating a user
 * quota row or a chat message. This is the admin probe that the old connection
 * test was missing: it exercises the active reference, response download, bucket
 * upload, and signed URL creation using the same provider executor as chat.
 */
export async function runFullCabiImageTest(input: {
  config: ResolvedImageGenerationConfig;
  trace?: ImagePipelineTrace;
}): Promise<FullCabiImageTestResult> {
  const trace = input.trace ?? createImagePipelineTrace({ source: "ADMIN_TEST", aspectRatio: input.config.aspectRatio });
  const size = aspectRatioSizes[input.config.aspectRatio];
  trace.update({
    provider: input.config.provider,
    model: input.config.model,
    aspectRatio: input.config.aspectRatio,
    width: size.width,
    height: size.height,
  });
  trace.record("IMAGE_CONFIG_RESOLVED", {
    provider: input.config.provider,
    model: input.config.model,
    aspectRatio: input.config.aspectRatio,
    width: size.width,
    height: size.height,
  });

  if (!input.config.apiKey) {
    trace.record("TOGETHER_REQUEST_STARTED", { error: "NOT_CONFIGURED" });
    trace.record("FINAL_RESPONSE_RETURNED", { error: "NOT_CONFIGURED" });
    logImagePipelineTrace(trace);
    return { ok: false, message: "Together AI key is not configured.", trace };
  }

  const planned = await buildCabiGenerationPlan({
    scene: "Cabi standing in a softly lit studio",
    aspectRatio: input.config.aspectRatio,
    modelSupportsReferenceImages: input.config.capabilities.supportsReferenceImages,
  });
  if (!planned.ok) {
    trace.record("CABI_REFERENCE_RESOLVED", { error: "REFERENCE_UNAVAILABLE" });
    trace.record("FINAL_RESPONSE_RETURNED", { error: "REFERENCE_UNAVAILABLE" });
    logImagePipelineTrace(trace);
    return { ok: false, message: planned.message, trace };
  }

  const plan = planned.plan;
  recordCabiPlanStages(trace, input.config, plan);
  const pipeline = await runCabiImagePipeline({
    config: input.config,
    plan,
    source: "ADMIN_TEST",
    trace,
    walletAccountId: "admin-tests",
    generationId: crypto.randomUUID(),
  });
  if (!pipeline.ok) {
    if (pipeline.path) await deleteGenerationImage(pipeline.path).catch(() => false);
    trace.record("FINAL_RESPONSE_RETURNED", { error: pipeline.error });
    logImagePipelineTrace(trace);
    return { ok: false, message: "The full Cabi generation failed.", trace };
  }

  // The probe verifies the object and signed URL, then removes its temporary
  // object so repeated admin diagnostics do not become user gallery entries.
  await deleteGenerationImage(pipeline.uploaded.path).catch(() => false);
  trace.record("FINAL_RESPONSE_RETURNED");
  logImagePipelineTrace(trace);
  return {
    ok: true,
    message: "Full Cabi generation, image download, private upload, and signed URL verified.",
    trace,
    referenceConditioned: pipeline.generated.referenceConditioned,
    referenceFallbackUsed: pipeline.generated.referenceFallbackUsed,
    promptFallbackUsed: pipeline.generated.promptFallbackUsed,
  };
}
