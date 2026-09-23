import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { classifyCabiRelevance, checkImageScope, extractScene, looksLikeImageRequest, offTopicReply, uncertainReply } from "@/lib/image-generation/scope";
import { createImageProvider } from "@/lib/image-generation/provider";
import { readImageProviderConfig, readImageSettings } from "@/lib/image-generation/settings";
import { generationBucket, signedImageUrl, uploadGenerationImage } from "@/lib/image-generation/storage";
import { awardImageXp, countImageXpToday } from "@/lib/ranking/service";
import { readProfile } from "@/lib/profiles/service";
import { initialsFor } from "@/lib/profiles/username";
import { imageGenerationTtlMs } from "@/lib/image-generation/cache";
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

  const settings = await readImageSettings();

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

  const providerConfig = await readImageProviderConfig();
  if (!providerConfig) {
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

  const provider = createImageProvider({
    provider: providerConfig.settings.provider,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.settings.baseUrl,
    model: providerConfig.settings.model,
    supportsReferenceImage: true,
  });

  const aspectRatio = providerConfig.settings.defaultAspectRatio;
  const generated = await provider.generateCabiImage({
    scene: scene,
    aspectRatio,
    quality: providerConfig.settings.defaultQuality,
  });

  if (!generated.ok) {
    // Recorded FAILED, which the quota function does not count, so a provider
    // outage never burns the user's allowance.
    await db.from("image_generations").insert({
      wallet_account_id: walletAccountId,
      conversation_id: options.conversationId,
      user_prompt: scene,
      aspect_ratio: aspectRatio,
      provider: providerConfig.settings.provider,
      model: providerConfig.settings.model,
      status: "FAILED",
      failure_code: generated.error,
    });
    return {
      handled: true,
      usedProvider: true,
      reply: generated.message,
      card: noticeCard({ title: "I could not draw that one", message: generated.message, tone: "caution" }),
    };
  }

  const generationId = crypto.randomUUID();
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

  const { data: row } = await db
    .from("image_generations")
    .insert({
      id: generationId,
      wallet_account_id: walletAccountId,
      conversation_id: options.conversationId,
      message_id: options.messageId,
      user_prompt: scene,
      aspect_ratio: aspectRatio,
      image_path: uploaded.path,
      provider: generated.image.provider,
      model: generated.image.model,
      status: "SUCCEEDED",
    })
    .select("id,created_at")
    .maybeSingle();

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

  const prompt = scene;
  const reply = "Okayyy, give me a second. Here you go.";

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