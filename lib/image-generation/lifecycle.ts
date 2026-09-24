import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { imageGenerationTtlMs } from "@/lib/image-generation/cache";
import type { ActionCard } from "@/lib/actions/types";
import { parseActionCard } from "@/lib/actions/guards";

/**
 * The image generation lifecycle.
 *
 * Two problems this module exists to solve.
 *
 * 1. **A signed URL is not history.** A generation row stores an object PATH,
 *    because a signed URL expires in ten minutes. Anything that renders a stored
 *    image card has to mint a fresh URL from the path on read. Persisting the
 *    URL instead is the bug that shows a user "this image link has expired" when
 *    they reopen yesterday's conversation.
 *
 * 2. **A state has to be durable.** QUEUED → GENERATING → COMPLETED|FAILED is
 *    recorded in the database with a timestamp per transition, so a refresh
 *    mid-generation recovers to the truth rather than to a placeholder.
 */

export type GenerationStatus = "QUEUED" | "GENERATING" | "COMPLETED" | "FAILED";

export type GenerationRecord = {
  id: string;
  status: GenerationStatus;
  prompt: string;
  aspectRatio: string;
  imagePath: string | null;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  parentGenerationId: string | null;
};

/** How long a signed URL stays valid when the UI renders a stored image. */
export const cardUrlTtlSeconds = Math.floor(imageGenerationTtlMs / 1_000);

const recordColumns = "id,status,user_prompt,aspect_ratio,image_path,created_at,queued_at,started_at,completed_at,failed_at,failure_message,parent_generation_id";

function toRecord(row: Record<string, unknown>): GenerationRecord {
  return {
    id: String(row.id),
    status: (row.status as GenerationStatus) ?? "FAILED",
    prompt: String(row.user_prompt ?? ""),
    aspectRatio: String(row.aspect_ratio ?? "1:1"),
    imagePath: (row.image_path as string | null) ?? null,
    createdAt: String(row.created_at),
    queuedAt: (row.queued_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    failureMessage: (row.failure_message as string | null) ?? null,
    parentGenerationId: (row.parent_generation_id as string | null) ?? null,
  };
}

/**
 * Attaches a finished generation to the assistant message that displays it.
 *
 * The chat route does not know the message id until after the reply is stored,
 * so the link is made here rather than at generation time. This link is what
 * lets a reopened conversation find the generation and mint a fresh signed URL.
 */
export async function linkGenerationToMessage(generationId: string, assistantMessageId: string) {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("image_generations")
    .update({ assistant_message_id: assistantMessageId })
    .eq("id", generationId);
}

/** One generation, scoped to its owner so a caller cannot read another wallet's. */
export async function readGeneration(walletAccountId: string, generationId: string): Promise<GenerationRecord | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("image_generations")
    .select(recordColumns)
    .eq("id", generationId)
    .eq("wallet_account_id", walletAccountId)
    .maybeSingle();
  return data ? toRecord(data as Record<string, unknown>) : null;
}

/** The generations attached to one assistant message, oldest first. */
export async function readGenerationsForMessages(messageIds: readonly string[]): Promise<Map<string, GenerationRecord>> {
  const map = new Map<string, GenerationRecord>();
  if (messageIds.length === 0) return map;
  const db = getServiceClient();
  if (!db) return map;
  const { data } = await db
    .from("image_generations")
    .select(`${recordColumns},assistant_message_id`)
    .in("assistant_message_id", messageIds as string[]);
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const messageId = row.assistant_message_id as string | null;
    // A message has at most one image, so a later duplicate never overwrites the
    // first: the first is the one the user saw in that position.
    if (messageId && !map.has(messageId)) map.set(messageId, toRecord(row));
  }
  return map;
}

/** Marks a row as in progress. Called immediately before the provider request. */
export async function markGenerating(generationId: string) {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("image_generations")
    .update({ status: "GENERATING", started_at: new Date().toISOString() })
    .eq("id", generationId)
    .eq("status", "QUEUED");
}

export async function markCompleted(input: {
  generationId: string;
  imagePath: string;
  provider: string;
  model: string;
  assistantMessageId?: string | null;
}) {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("image_generations")
    .update({
      status: "COMPLETED",
      image_path: input.imagePath,
      provider: input.provider,
      model: input.model,
      completed_at: new Date().toISOString(),
      assistant_message_id: input.assistantMessageId ?? null,
      failure_code: null,
      failure_message: null,
    })
    .eq("id", input.generationId);
}

export async function markFailed(input: {
  generationId: string;
  code: string;
  message: string;
  assistantMessageId?: string | null;
}) {
  const db = getServiceClient();
  if (!db) return;
  await db
    .from("image_generations")
    .update({
      status: "FAILED",
      failure_code: input.code,
      failure_message: input.message,
      failed_at: new Date().toISOString(),
      assistant_message_id: input.assistantMessageId ?? null,
    })
    .eq("id", input.generationId);
}

/**
 * Signs a card's image from its stored path.
 *
 * Returns the card unchanged when it carries no generation id, so non-image
 * cards pass through untouched.
 */
export async function refreshCardUrl(card: ActionCard): Promise<ActionCard> {
  if (card.kind !== "IMAGE") return card;
  const db = getServiceClient();
  if (!db) return card;
  const { data } = await db
    .from("image_generations")
    .select("image_path,status")
    .eq("id", card.generationId)
    .maybeSingle();
  const row = data as { image_path: string | null; status: GenerationStatus } | null;
  if (!row?.image_path || row.status !== "COMPLETED") return card;
  const url = await signedImageUrl(generationBucket, row.image_path, cardUrlTtlSeconds);
  return url ? { ...card, url } : card;
}

/**
 * Re-signs every stored image card in a conversation.
 *
 * Called when a conversation is opened, so an image generated yesterday renders
 * today. The stored card's URL is treated as a cache that has certainly expired,
 * never as the source of truth.
 */
export async function refreshStoredCards<T extends { id: string; role: string; metadata_json?: unknown }>(
  messages: readonly T[],
): Promise<T[]> {
  const imageMessages = messages.filter((message) => {
    const meta = message.metadata_json as { actionCard?: unknown } | null;
    const card = meta?.actionCard as { kind?: string; generationId?: string } | undefined;
    return card?.kind === "IMAGE" && typeof card.generationId === "string";
  });
  if (imageMessages.length === 0) return [...messages];

  const generations = await readGenerationsForMessages(imageMessages.map((message) => message.id));
  return Promise.all(messages.map(async (message) => {
    const meta = message.metadata_json as { actionCard?: unknown } | null;
    if (!meta?.actionCard) return message;
    const safe = parseActionCard(meta.actionCard);
    if (!safe) return message;
    if (safe.kind !== "IMAGE") return message;

    const generation = generations.get(message.id);
    // A generation still running, or one that failed, is rendered as its state
    // rather than as a stale image.
    if (generation && generation.status !== "COMPLETED") {
      return { ...message, metadata_json: { ...meta, actionCard: safe, generationStatus: generation.status, generationFailure: generation.failureMessage } };
    }
    const refreshed = await refreshCardUrl(safe);
    return { ...message, metadata_json: { ...meta, actionCard: refreshed } };
  }));
}

/**
 * Deletes a generation and its stored object.
 *
 * Ownership is part of the lookup rather than a check afterwards, so a request
 * naming another wallet's id removes nothing.
 */
export async function deleteGeneration(walletAccountId: string, generationId: string): Promise<{ ok: true } | { ok: false; reason: "NOT_FOUND" | "STORAGE_FAILED" }> {
  const db = getServiceClient();
  if (!db) return { ok: false, reason: "NOT_FOUND" };

  const { data } = await db
    .from("image_generations")
    .select("image_path")
    .eq("id", generationId)
    .eq("wallet_account_id", walletAccountId)
    .maybeSingle();
  if (!data) return { ok: false, reason: "NOT_FOUND" };

  const path = (data as { image_path: string | null }).image_path;
  // Storage first: a row without an object is recoverable, an orphaned object is
  // not reachable at all.
  if (path) {
    const { error } = await db.storage.from(generationBucket).remove([path]);
    if (error) return { ok: false, reason: "STORAGE_FAILED" };
  }
  await db.from("image_generations").delete().eq("id", generationId).eq("wallet_account_id", walletAccountId);
  return { ok: true };
}

/** Today's allowance and counters for one wallet. */
export type QuotaSnapshot = {
  used: number;
  remaining: number;
  allowed: boolean;
  dailyLimit: number;
  failedToday: number;
  inFlight: number;
  resetsAt: string | null;
};

export async function readQuota(walletAccountId: string, dailyLimit: number): Promise<QuotaSnapshot> {
  const fallback: QuotaSnapshot = { used: 0, remaining: dailyLimit, allowed: true, dailyLimit, failedToday: 0, inFlight: 0, resetsAt: null };
  const db = getServiceClient();
  if (!db) return fallback;
  const { data, error } = await db.rpc("image_generation_quota", {
    p_wallet_account_id: walletAccountId,
    p_daily_limit: dailyLimit,
  });
  if (error) return fallback;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return fallback;
  return {
    used: Number(row.used ?? 0),
    remaining: Number(row.remaining ?? dailyLimit),
    allowed: Boolean(row.allowed),
    dailyLimit: Number(row.daily_limit ?? dailyLimit),
    failedToday: Number(row.failed_today ?? 0),
    inFlight: Number(row.in_flight ?? 0),
    resetsAt: (row.resets_at as string | null) ?? null,
  };
}
/* ---------------------------------------------------------------------------
 * My Cabi Images and regeneration lineage.
 * ------------------------------------------------------------------------- */

export type GenerationListItem = {
  id: string;
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  url: string | null;
  status: GenerationStatus;
  failureMessage: string | null;
  parentGenerationId: string | null;
};

/**
 * A wallet's own completed images, newest first, with freshly signed URLs.
 *
 * Scoped by `wallet_account_id` in the query itself, so there is no id a caller
 * could pass to read another wallet's images. Signed per request rather than
 * stored, because a URL that leaks stops working.
 */
export async function listGenerations(walletAccountId: string, limit = 60): Promise<GenerationListItem[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("image_generations")
    .select(recordColumns)
    .eq("wallet_account_id", walletAccountId)
    // Failed and in-flight rows are not images the user can look at.
    .eq("status", "COMPLETED")
    .not("image_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const signed = await Promise.all(rows.map(async (row) => {
    const record = toRecord(row);
    const url = record.imagePath ? await signedImageUrl(generationBucket, record.imagePath, cardUrlTtlSeconds) : null;
    return {
      id: record.id,
      prompt: record.prompt,
      aspectRatio: record.aspectRatio,
      createdAt: record.createdAt,
      url,
      status: record.status,
      failureMessage: record.failureMessage,
      parentGenerationId: record.parentGenerationId,
    } satisfies GenerationListItem;
  }));
  // A row whose object is missing is dropped rather than shown as a gap.
  return signed.filter((item) => item.url);
}

/**
 * Records the CREATE for one generation.
 *
 * Regenerating from an existing image inserts a NEW row and points it at the
 * original, so the earlier image is preserved. Nothing is ever overwritten.
 */
export async function createGeneration(input: {
  walletAccountId: string;
  conversationId?: string | null;
  messageId?: string | null;
  prompt: string;
  aspectRatio: string;
  provider: string;
  model: string;
  parentGenerationId?: string | null;
}): Promise<string> {
  const db = getServiceClient();
  const id = crypto.randomUUID();
  if (!db) return id;
  await db.from("image_generations").insert({
    id,
    wallet_account_id: input.walletAccountId,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    user_prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    provider: input.provider,
    model: input.model,
    status: "QUEUED",
    queued_at: new Date().toISOString(),
    parent_generation_id: input.parentGenerationId ?? null,
  });
  return id;
}

/**
 * The safe scene behind a stored generation, for a regenerate request.
 *
 * Returns the original prompt only when the caller owns it, so a regenerate
 * cannot be used to read or re-run another wallet's prompt.
 */
export async function readRegenerateScene(walletAccountId: string, generationId: string): Promise<string | null> {
  const record = await readGeneration(walletAccountId, generationId);
  return record?.prompt ?? null;
}

/**
 * The scene, expression, and outfit behind a stored generation.
 *
 * Used by a follow-up ("make another one but smiling") so the new image carries
 * the previous scene forward and changes only what was asked for. Owner-scoped in
 * the query itself, so it can never read another wallet's image context.
 */
export type GenerationContext = {
  scene: string | null;
  expression: string | null;
  outfit: string | null;
  referenceVersion: number | null;
};

const contextColumns = "scene,user_prompt,expression,outfit,reference_version";

function toContext(row: Record<string, unknown>): GenerationContext {
  return {
    scene: (row.scene as string | null) ?? (row.user_prompt as string | null) ?? null,
    expression: (row.expression as string | null) ?? null,
    outfit: (row.outfit as string | null) ?? null,
    referenceVersion: row.reference_version == null ? null : Number(row.reference_version),
  };
}

export async function readGenerationContext(walletAccountId: string, generationId: string): Promise<GenerationContext | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("image_generations")
    .select(contextColumns)
    .eq("id", generationId)
    .eq("wallet_account_id", walletAccountId)
    .maybeSingle();
  return data ? toContext(data as Record<string, unknown>) : null;
}

/**
 * The most recent image the wallet generated in a conversation.
 *
 * This is what makes "now put yourself in a hoodie" work with no back-reference
 * typed by the user: the previous image in the same conversation supplies the
 * scene to carry forward.
 */
export async function readLatestGenerationContext(walletAccountId: string, conversationId: string | null): Promise<GenerationContext | null> {
  const db = getServiceClient();
  if (!db) return null;
  let query = db
    .from("image_generations")
    .select(contextColumns)
    .eq("wallet_account_id", walletAccountId)
    .eq("status", "COMPLETED");
  // With no conversation, the wallet's own most recent image is still the right
  // context: it is the picture they are looking at.
  if (conversationId) query = query.eq("conversation_id", conversationId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? toContext(data as Record<string, unknown>) : null;
}