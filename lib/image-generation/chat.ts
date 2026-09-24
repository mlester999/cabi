import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { classifyCabiRelevance, checkImageScope, extractScene, looksLikeImageRequest, offTopicReply, uncertainReply } from "@/lib/image-generation/scope";
import { createImageProvider } from "@/lib/image-generation/provider";
import { executeImageGeneration } from "@/lib/image-generation/execute";
import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { parseCabiSceneRequest } from "@/lib/image-generation/parse-scene";
import { resolveImageGenerationConfig } from "@/lib/image-generation/settings";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import { awardImageXp, countImageXpToday } from "@/lib/ranking/service";
import { readProfile } from "@/lib/profiles/service";
import { initialsFor } from "@/lib/profiles/username";
import { imageGenerationTtlMs } from "@/lib/image-generation/cache";
import { markCompleted, markFailed, markGenerating } from "@/lib/image-generation/lifecycle";
import { checkImageSafety } from "@/lib/image-generation/safety";
import { noticeCard, imageCard } from "@/lib/actions/cards";
import type { ActionCard } from "@/lib/actions/types";

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
};

export type ChatImageResult =
  | { handled: false }
  | { handled: true; card: ActionCard; reply: string; usedProvider: boolean };

/** True when this message is asking Cabi to draw something. */
export function isImageRequest(message: string): boolean {
  return looksLikeImageRequest(message);
}

export async function generateChatImage(message: string, options: ChatImageOptions): Promise<ChatImageResult> {
  if (!isImageRequest(message)) return { handled: false };

  // This is the same live resolver used by the admin test. It reads the saved
  // model, endpoint, key source, capabilities, quality and limits together, so
  // chat cannot silently use a different model or stale provider setting.
  const imageConfig = await resolveImageGenerationConfig();
  const settings = imageConfig.settings;

  // Scope is decided FIRST, before the enabled check and before the wallet
  // check. Cabi-only enforcement is a product rule, not a feature flag: an
  // off-topic request must be redirected in her own voice even while the feature
  // is switched off, rather than being answered with a generic "it is off".
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
  const scene = extractScene(message);
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

  /*
   * Safety runs AFTER relevance and BEFORE the wallet/quota/provider steps, and
   * is a separate question: "Cabi holding a knife" is unmistakably about Cabi and
   * still must not be drawn. Checking relevance alone would spend a credit on it.
   */
  const safety = checkImageSafety(scene);
  if (!safety.safe) {
    return {
      handled: true,
      usedProvider: false,
      reply: safety.message,
      card: noticeCard({ title: "I will not draw that", message: safety.message, tone: "caution" }),
    };
  }

  // Generation costs money per call, so it is tied to a wallet for quota.
  if (!options.walletAccountId && !settings.allowGuestGeneration) {
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
  if (options.walletAccountId) {
    const { data: quotaData } = await db.rpc("image_generation_quota", {
      p_wallet_account_id: walletAccountId,
      p_daily_limit: settings.dailyLimit,
    });
    const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as { allowed?: boolean } | undefined;
    if (quota && quota.allowed === false) {
      return {
        handled: true,
        usedProvider: false,
        reply: `That is all ${settings.dailyLimit} images for today. More tomorrow.`,
        card: noticeCard({ title: "Daily image limit reached", message: `You have used all ${settings.dailyLimit} of today's images. The allowance resets at midnight UTC.`, tone: "caution" }),
      };
    }
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
    return {
      handled: true,
      usedProvider: false,
      reply: planned.message,
      card: noticeCard({ title: "Cabi's reference image is unavailable", message: planned.message, tone: "caution" }),
    };
  }
  const plan = planned.plan;

  /*
   * The row is created as QUEUED before the provider is called, so an in-flight
   * generation is visible to a refresh rather than existing only inside this
   * request. The same row is then transitioned forward, which is what gives the
   * UI three honest, recoverable states instead of one.
   */
  const queuedAt = new Date().toISOString();
  const generationId = crypto.randomUUID();
  /*
   * A failure to write the QUEUED row must not abort the generation: the user
   * asked for an image, and losing the audit trail is a smaller harm than losing
   * the image. The lifecycle transitions below are independently guarded for the
   * same reason.
   */
  try {
    await db.from("image_generations").insert({
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
    });
  } catch {
    // Generation continues; the row simply will not exist to transition.
  }


  const provider = createImageProvider({
    provider: imageConfig.provider,
    apiKey,
    baseUrl: imageConfig.endpoint,
    model: imageConfig.model,
    supportsReferenceImage: capabilities.supportsReferenceImages,
    capabilities,
  });

  // QUEUED -> GENERATING, recorded before the request leaves the process so a
  // refresh mid-flight recovers to "still working" rather than to a placeholder.
  await markGenerating(generationId);
  const generated = await executeImageGeneration({
    source: "CHAT_GENERATION",
    config: imageConfig,
    provider,
    referenceVersion: plan.reference.version,
    request: {
      scene: plan.scene,
      aspectRatio,
      quality: imageConfig.quality,
      seed: plan.seed ?? undefined,
      negativePrompt: plan.negative,
      referenceImages: plan.referenceImages,
      preparedPrompt: plan.prompt,
    },
  });

  // If the reference-specific retry was used, the stored row must describe the
  // request that actually succeeded rather than the request that first failed.
  if (generated.referenceConditioned !== plan.capabilities.referenceConditioning) {
    try {
      await db.from("image_generations").update({ reference_conditioned: generated.referenceConditioned }).eq("id", generationId);
    } catch {
      // The image itself remains valid; this is best-effort metadata repair.
    }
  }

  if (!generated.ok) {
    // FAILED does not consume the daily allowance, so a provider outage never
    // burns one of the user's images.
    await markFailed({ generationId, code: generated.error, message: generated.message });
    return {
      handled: true,
      usedProvider: true,
      reply: "",
      card: noticeCard({
        title: "Couldn't make that image",
        message: "I couldn't make that image right now. You can try again when you're ready.",
        tone: "error",
        retry: { label: "Try Again", prompt: message, parentGenerationId: generationId },
      }),
    };
  }

  const uploaded = await uploadGenerationImage({
    walletAccountId,
    generationId,
    bytes: generated.image.bytes,
    contentType: generated.image.contentType,
  });
  if (!uploaded.ok) {
    return {
      handled: true,
      usedProvider: true,
      reply: "I drew it but could not save it.",
      card: noticeCard({ title: "Could not save that image", message: uploaded.message, tone: "caution" }),
    };
  }

  // Transition the row that already exists rather than inserting a second one,
  // so the generation the user watched is the generation they keep.
  await markCompleted({
    generationId,
    imagePath: uploaded.path,
    provider: generated.image.provider,
    model: generated.image.model,
  });
  const row = { id: generationId, created_at: queuedAt };

  const url = await signedImageUrl(generationBucket, uploaded.path, Math.floor(imageGenerationTtlMs / 1_000));
  if (!url) {
    return {
      handled: true,
      usedProvider: true,
      reply: "I drew it but could not open it.",
      card: noticeCard({ title: "Could not open that image", message: "The signed link failed.", tone: "caution" }),
    };
  }

  // First image of the day only, capped hard so paid API calls can never become
  // a route up the leaderboard.
  const xp = options.walletAccountId
    ? await awardImageXp({ walletAccountId, imagesRewardedToday: await countImageXpToday(walletAccountId), conversationId: options.conversationId }).catch(() => null)
    : null;
  const profile = options.walletAccountId ? await readProfile(walletAccountId) : null;

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
