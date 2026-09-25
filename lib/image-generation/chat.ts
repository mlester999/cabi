import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { classifyCabiRelevance, checkImageScope, extractScene, looksLikeImageRequest, offTopicReply, uncertainReply } from "@/lib/image-generation/scope";
import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { parseCabiSceneRequest } from "@/lib/image-generation/parse-scene";
import { resolveImageGenerationConfig } from "@/lib/image-generation/settings";
import { awardImageXp, countImageXpToday } from "@/lib/ranking/service";
import { readProfile } from "@/lib/profiles/service";
import { initialsFor } from "@/lib/profiles/username";
import { markCompleted, markFailed, markGenerating } from "@/lib/image-generation/lifecycle";
import { checkImageSafety } from "@/lib/image-generation/safety";
import { noticeCard, imageCard } from "@/lib/actions/cards";
import type { ActionCard } from "@/lib/actions/types";
import { createImagePipelineTrace, type ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import { imagePipelineDatabaseFields, logImageDatabaseFailure, logImagePipelineTrace, persistImageDatabaseFailure } from "@/lib/image-generation/diagnostics";
import { recordCabiPlanStages, runCabiImagePipeline } from "@/lib/image-generation/pipeline";
import { deleteGenerationImage } from "@/lib/image-generation/storage";

/**
 * Chat-driven Cabi image generation.
 *
 * This is the path a person actually uses: "make a picture of you drinking
 * coffee". It reuses the exact same provider, scope guard, storage and quota as
 * the HTTP endpoint, so the two can never disagree about what is allowed or how
 * much a user has left.
 *
 * Every refusal is a rendered card rather than an error page, because the brief
 * asks Cabi to redirect an off-topic request in her own voice.
 */

export type ChatImageOptions = {
  /**
   * Recent transcript, most recent last. Used only to resolve a back-reference
   * such as "put her in a gaming chair" to Cabi.
   */
  conversationContext?: readonly string[];
  /**
   * The generation being regenerated, when the user pressed Regenerate. The new
   * row points at the original, so regenerating never destroys the old image.
   */
  parentGenerationId?: string | null;
  /**
   * The previous image in this conversation, so a follow-up such as "now put
   * yourself in a hoodie" carries its scene forward. Read server-side from the
   * wallet's own generations; never supplied by a client.
   */
  previousImageContext?: { scene?: string | null; expression?: string | null; outfit?: string | null } | null;
  walletAccountId: string | null;
  conversationId: string | null;
  messageId: string | null;
  /** Shared with the chat route so message creation and image stages have one ID. */
  trace?: ImagePipelineTrace;
  /** True only for an explicitly authorized owner/admin preview request. */
  ownerPreview?: boolean;
  /** Internal owner-admin test only: avoid charging normal user quota or XP. */
  adminPipelineTest?: boolean;
};

export type ChatImageResult =
  | { handled: false; trace?: ImagePipelineTrace }
  | { handled: true; card: ActionCard; reply: string; usedProvider: boolean; trace?: ImagePipelineTrace };

/** True when this message is asking Cabi to draw something. */
export function isImageRequest(message: string): boolean {
  return looksLikeImageRequest(message);
}

function imageFailureCard(message: string, ownerPreview: boolean, parentGenerationId?: string): ActionCard {
  return noticeCard({
    title: "Couldn't make that image.",
    message: "I ran into a problem while making it.",
    tone: "error",
    retry: { label: "Try Again", prompt: message, ...(parentGenerationId ? { parentGenerationId } : {}) },
    links: ownerPreview ? [{ label: "View in Admin", url: "/admin/images#recent-generation-runs", kind: "INTERNAL" }] : [],
  });
}

export async function generateChatImage(message: string, options: ChatImageOptions): Promise<ChatImageResult> {
  if (!isImageRequest(message)) return { handled: false };

  const trace = options.trace ?? createImagePipelineTrace({
    source: "CHAT_GENERATION",
    walletAccountId: options.walletAccountId,
    conversationId: options.conversationId,
  });
  if (!options.trace) trace.record("IMAGE_INTENT_DETECTED");

  try {
    const result = await generateChatImageInternal(message, { ...options, trace });
    trace.record("FINAL_RESPONSE_RETURNED");
    logImagePipelineTrace(trace);
    return result;
  } catch {
    trace.record("FINAL_RESPONSE_RETURNED", { error: "UNEXPECTED_PIPELINE_ERROR" });
    logImagePipelineTrace(trace);
    return {
      handled: true,
      usedProvider: false,
      reply: "",
      card: imageFailureCard(message, Boolean(options.ownerPreview)),
    };
  }
}

async function generateChatImageInternal(message: string, options: ChatImageOptions & { trace: ImagePipelineTrace }): Promise<ChatImageResult> {
  const trace = options.trace;

  const scene = extractScene(message);
  const safety = checkImageSafety(scene);
  if (!safety.safe) {
    return {
      handled: true,
      usedProvider: false,
      reply: safety.message,
      card: noticeCard({ title: "I will not draw that", message: safety.message, tone: "caution" }),
    };
  }

  // Scope follows application safety and still runs before the enabled check or
  // wallet check. Cabi-only enforcement is a product rule, not a feature flag:
  // off-topic requests are redirected even while the feature is switched off.
  const scope = checkImageScope(message);
  if (!scope.allowed && scope.reason === "BLOCKED_CONTENT") {
    return {
      handled: true,
      usedProvider: false,
      reply: "I am not going to draw that one.",
      card: noticeCard({ title: "I will not draw that", message: scope.message, tone: "caution" }),
    };
  }

  /*
   * Relevance is decided with conversation context, so "put her in a gaming
   * chair" works after a turn about Cabi. An UNCERTAIN verdict asks rather than
   * guessing, and neither verdict reaches the provider, so no credit is spent.
   */
  // Derived directly rather than read off the scope union: the classifier, not
  // the scope helper, is now the authority on whether we generate.
  const verdict = classifyCabiRelevance(message, options.conversationContext ?? []);
  if (verdict !== "CABI_RELATED") {
    const suggestion = scope.allowed ? null : scope.suggestion;
    return {
      handled: true,
      usedProvider: false,
      reply: verdict === "UNCERTAIN" ? uncertainReply(message) : offTopicReply(message),
      card: noticeCard({
        title: verdict === "UNCERTAIN" ? "Who am I drawing?" : "I only draw Cabi",
        message: suggestion ? `I can make "${suggestion}" instead. Say the word and I will.` : "Tell me what I am doing in the picture and I will make it.",
        tone: "caution",
        rows: suggestion ? [{ label: "Try instead", value: suggestion }] : [],
      }),
    };
  }

  // Resolve provider settings only after the free application-safety and
  // relevance checks have passed. This is the same resolver used by admin test.
  const imageConfig = await resolveImageGenerationConfig();
  const settings = imageConfig.settings;
  trace.record("IMAGE_CONFIG_RESOLVED", {
    provider: imageConfig.provider,
    model: imageConfig.model,
    aspectRatio: imageConfig.aspectRatio,
  });

  // Switched off in admin: say so plainly, but only once the request has already
  // been shown to be an in-scope Cabi image.
  if (!settings.enabled) {
    return {
      handled: true,
      usedProvider: false,
      reply: "My image studio is switched off right now.",
      card: noticeCard({
        title: "Image generation is off",
        message: "The owner has not enabled Cabi image generation yet.",
      }),
    };
  }

  // Generation costs money per call, so it is tied to a wallet for quota.
  if (!options.walletAccountId && !settings.allowGuestGeneration) {
    trace.record("USER_AUTHORIZED", { error: "WALLET_REQUIRED" });
    return {
      handled: true,
      usedProvider: false,
      reply: "Connect your wallet to generate Cabi images.",
      card: noticeCard({
        title: "Connect your wallet first",
        message: "Image generation is tied to a wallet so I can track your daily allowance and keep your gallery private.",
        links: [{ label: "Open settings", url: "/settings", kind: "INTERNAL" }],
      }),
    };
  }

  trace.record("USER_AUTHORIZED", { walletAccountId: options.walletAccountId, conversationId: options.conversationId });

  const db = getServiceClient();
  if (!db) {
    return {
      handled: true,
      usedProvider: false,
      reply: "I cannot save images right now.",
      card: noticeCard({ title: "Image storage is not configured", message: "Ask the owner to set up the image buckets.", tone: "caution" }),
    };
  }

  const apiKey = imageConfig.apiKey;
  if (!apiKey) {
    return {
      handled: true,
      usedProvider: false,
      reply: "My image provider is not configured yet.",
      card: noticeCard({ title: "Image provider not configured", message: "The owner needs to add an image API key.", tone: "caution" }),
    };
  }

  const walletAccountId = options.walletAccountId ?? "00000000-0000-0000-0000-000000000000";

  // Quota is counted in the database so two concurrent chats cannot both take
  // the final slot.
  if (options.walletAccountId && !options.adminPipelineTest) {
    const { data: quotaData, error: quotaError } = await db.rpc("image_generation_quota", {
      p_wallet_account_id: walletAccountId,
      p_daily_limit: settings.dailyLimit,
    });
    trace.record("QUOTA_CHECK_PASSED", { error: quotaError ? "QUOTA_CHECK_FAILED" : null });
    const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as { allowed?: boolean } | undefined;
    if (quota && quota.allowed === false) {
      return {
        handled: true,
        usedProvider: false,
        reply: `That is all ${settings.dailyLimit} images for today. More tomorrow.`,
        card: noticeCard({ title: "Daily image limit reached", message: `You have used all ${settings.dailyLimit} of today's images. The allowance resets at midnight UTC.`, tone: "caution" }),
      };
    }
  } else {
    trace.record("QUOTA_CHECK_PASSED");
  }

  /*
   * Capability decides whether the official reference may be attached. It is read
   * from the selected MODEL: an unsupported parameter is never sent, and the admin
   * console states which case applies rather than implying consistency the model
   * cannot deliver.
   */
  const capabilities = imageConfig.capabilities;
  const aspectRatio = imageConfig.aspectRatio;

  // Expression, outfit, and the scene to carry forward. The scene comes from this
  // message; the identity layers are added by the plan and cannot be influenced
  // from here.
  const sceneRequest = parseCabiSceneRequest(message, options.previousImageContext ?? null);
  const planned = await buildCabiGenerationPlan({
    scene: sceneRequest.scene,
    aspectRatio,
    expression: sceneRequest.expression,
    outfit: sceneRequest.outfit,
    outfitNote: sceneRequest.outfitNote,
    sceneNote: sceneRequest.sceneNote,
    modelSupportsReferenceImages: capabilities.supportsReferenceImages,
  });
  if (!planned.ok) {
    // No usable reference: fail clearly rather than draw an unrelated character.
    trace.record("CABI_REFERENCE_RESOLVED", { error: "REFERENCE_UNAVAILABLE" });
    return {
      handled: true,
      usedProvider: false,
      reply: planned.message,
      card: noticeCard({ title: "Cabi's reference image is unavailable", message: planned.message, tone: "caution" }),
    };
  }
  const plan = planned.plan;
  recordCabiPlanStages(trace, imageConfig, plan);

  /*
   * The row is created as QUEUED before the provider is called, so an in-flight
   * generation is visible to a refresh rather than existing only inside this
   * request. The same row is then transitioned forward, which is what gives the
   * UI three honest, recoverable states instead of one.
  */
  const queuedAt = new Date().toISOString();
  const generationId = crypto.randomUUID();
  try {
    const insertResult = await db.from("image_generations").insert({
      id: generationId,
      wallet_account_id: walletAccountId,
      conversation_id: options.conversationId ?? null,
      message_id: options.messageId ?? null,
      user_prompt: plan.scene,
      aspect_ratio: aspectRatio,
      provider: imageConfig.provider,
      model: imageConfig.model,
      status: "QUEUED",
      queued_at: queuedAt,
      parent_generation_id: options.parentGenerationId ?? null,
      // The safe metadata only: what varied, and which reference version produced
      // it. The identity and prompt layers stay out of the row.
      scene: plan.scene,
      expression: plan.expression,
      outfit: plan.outfit,
      reference_version: plan.reference.version,
      seed: plan.seed,
      reference_conditioned: plan.capabilities.referenceConditioning,
      ...imagePipelineDatabaseFields(trace),
    });
    if (insertResult?.error) {
      trace.record("GENERATION_ROW_CREATED", { error: "DATABASE_INSERT_FAILED" });
      logImageDatabaseFailure({ requestId: trace.requestId, operation: "insert", error: insertResult.error });
      await persistImageDatabaseFailure({ requestId: trace.requestId, operation: "insert", error: insertResult.error, walletAccountId: options.walletAccountId });
      return { handled: true, usedProvider: false, reply: "", card: imageFailureCard(message, Boolean(options.ownerPreview)) };
    }
    trace.record("GENERATION_ROW_CREATED");
  } catch (error) {
    trace.record("GENERATION_ROW_CREATED", { error: "DATABASE_INSERT_FAILED" });
    logImageDatabaseFailure({ requestId: trace.requestId, operation: "insert", error });
    await persistImageDatabaseFailure({ requestId: trace.requestId, operation: "insert", error, walletAccountId: options.walletAccountId });
    return { handled: true, usedProvider: false, reply: "", card: imageFailureCard(message, Boolean(options.ownerPreview)) };
  }
  // QUEUED -> GENERATING, recorded before the request leaves the process so a
  // refresh mid-flight recovers to "still working" rather than to a placeholder.
  const markedGenerating = await markGenerating(generationId);
  if (!markedGenerating) {
    trace.record("GENERATION_ROW_UPDATED", { error: "DATABASE_UPDATE_FAILED" });
    return { handled: true, usedProvider: false, reply: "", card: imageFailureCard(message, Boolean(options.ownerPreview)) };
  }
  trace.record("GENERATION_ROW_UPDATED");
  const pipeline = await runCabiImagePipeline({
    source: "CHAT_GENERATION",
    config: imageConfig,
    plan,
    trace,
    walletAccountId,
    generationId,
  });

  if (!pipeline.ok) {
    // FAILED does not consume the daily allowance, so a provider outage never
    // burns one of the user's images.
    const markedFailed = await markFailed({
      generationId,
      code: pipeline.error,
      message: pipeline.message,
      diagnostics: imagePipelineDatabaseFields(trace),
    });
    trace.record("GENERATION_ROW_UPDATED", { error: markedFailed === false ? "DATABASE_UPDATE_FAILED" : null });
    return {
      handled: true,
      usedProvider: true,
      reply: "",
      card: imageFailureCard(message, Boolean(options.ownerPreview), generationId),
    };
  }

  const { generated, uploaded, url } = pipeline;

  // Transition the row that already exists rather than inserting a second one,
  // so the generation the user watched is the generation they keep.
  const markedCompleted = await markCompleted({
    generationId,
    imagePath: uploaded.path,
    provider: generated.image.provider,
    model: generated.image.model,
    referenceConditioned: generated.referenceConditioned,
    diagnostics: imagePipelineDatabaseFields(trace),
  });
  if (!markedCompleted) {
    trace.record("GENERATION_ROW_UPDATED", { error: "DATABASE_UPDATE_FAILED" });
    const removed = await deleteGenerationImage(uploaded.path).catch(() => false);
    if (!removed) trace.record("SUPABASE_UPLOAD_COMPLETED", { error: "STORAGE_CLEANUP_FAILED" });
    await markFailed({
      generationId,
      code: "DATABASE_UPDATE_FAILED",
      message: "The image could not be saved.",
      diagnostics: imagePipelineDatabaseFields(trace),
    });
    return { handled: true, usedProvider: true, reply: "", card: imageFailureCard(message, Boolean(options.ownerPreview), generationId) };
  }
  trace.record("GENERATION_ROW_UPDATED");
  const row = { id: generationId, created_at: queuedAt };

  // First image of the day only, capped hard so paid API calls can never become
  // a route up the leaderboard.
  const xp = options.walletAccountId && !options.adminPipelineTest
    ? await awardImageXp({ walletAccountId, imagesRewardedToday: await countImageXpToday(walletAccountId), conversationId: options.conversationId }).catch(() => null)
    : null;
  const profile = options.walletAccountId && !options.adminPipelineTest ? await readProfile(walletAccountId) : null;

  // The scene is echoed because the user wrote it; the identity layers and the
  // reference path are never returned.
  const prompt = plan.scene;
  const reply = "Here you go.";

  return {
    handled: true,
    usedProvider: true,
    reply,
    card: imageCard({
      generationId: row?.id ?? generationId,
      url,
      prompt,
      aspectRatio,
      createdAt: row?.created_at ?? new Date().toISOString(),
      // Only offered once the user has claimed a name, so the avatar always has
      // somewhere to live.
      canUseAsAvatar: Boolean(profile?.profileCompletedAt),
      xp: xp?.xpAwarded ?? null,
      initials: profile?.username ? initialsFor(profile.username) : null,
    }),
  };
}
