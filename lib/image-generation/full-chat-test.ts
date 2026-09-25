import "server-only";

import { getServiceClient } from "@/lib/db/supabase";
import { generateChatImage } from "@/lib/image-generation/chat";
import { createImagePipelineTrace, type ImagePipelineDebugDetails, type ImagePipelineStage, type ImagePipelineTrace } from "@/lib/image-generation/pipeline-trace";
import { persistImageDatabaseFailure } from "@/lib/image-generation/diagnostics";
import { persistChatImageAttachment, refreshStoredCards } from "@/lib/image-generation/lifecycle";
import { deleteGenerationImage } from "@/lib/image-generation/storage";

export type ChatPipelineTestCheck = {
  label: string;
  state: "PASS" | "FAILED" | "SKIPPED";
};

export type FullChatImageTestResult = {
  ok: boolean;
  message: string;
  checks: ChatPipelineTestCheck[];
  diagnostics: ImagePipelineDebugDetails;
};

function stageState(trace: ImagePipelineTrace, stage: ImagePipelineStage): ChatPipelineTestCheck["state"] {
  const event = [...trace.snapshot().events].reverse().find((entry) => entry.stage === stage);
  return event ? (event.error ? "FAILED" : "PASS") : "SKIPPED";
}

/**
 * Exercises the real chat persistence path using a short-lived conversation
 * owned by the currently authenticated wallet. Provider/storage execution is
 * shared with chat; temporary rows and the uploaded object are removed before
 * the result is returned. The internal test flag skips normal quota and XP rewards.
 */
export async function runFullChatImageTest(input: {
  walletAccountId: string;
  profileId: string;
}): Promise<FullChatImageTestResult> {
  const db = getServiceClient();
  const trace = createImagePipelineTrace({ source: "CHAT_GENERATION", walletAccountId: input.walletAccountId });
  trace.record("IMAGE_INTENT_DETECTED");
  const checks = new Map<string, ChatPipelineTestCheck["state"]>([
    ["Wallet Identity", "SKIPPED"],
    ["Configuration", "SKIPPED"],
    ["Database Insert", "SKIPPED"],
    ["API Key", "SKIPPED"],
    ["Together", "SKIPPED"],
    ["Image Download", "SKIPPED"],
    ["Storage", "SKIPPED"],
    ["Database Update", "SKIPPED"],
    ["Message Attachment", "SKIPPED"],
    ["Read Back", "SKIPPED"],
    ["Cleanup", "SKIPPED"],
  ]);
  let conversationId: string | null = null;
  let conversationCreated = false;
  let userMessageId: string | null = null;
  let generationId: string | null = null;
  let failureMessage = "The full chat image pipeline failed.";

  if (!db) {
    return {
      ok: false,
      message: "The chat database is not configured.",
      checks: [...checks].map(([label, state]) => ({ label, state })),
      diagnostics: trace.snapshot(),
    };
  }

  try {
    const profile = await db.from("profiles")
      .select("id")
      .eq("id", input.profileId)
      .eq("wallet_account_id", input.walletAccountId)
      .maybeSingle();
    if (profile.error || !profile.data) {
      checks.set("Wallet Identity", "FAILED");
      if (profile.error) await persistImageDatabaseFailure({
        requestId: trace.requestId,
        operation: "chat_profile",
        table: "profiles",
        error: profile.error,
        walletAccountId: input.walletAccountId,
      });
      failureMessage = "The signed-in wallet and profile do not match the chat identity.";
      return await finishAfterCleanup(false);
    }
    checks.set("Wallet Identity", "PASS");
    trace.record("USER_AUTHORIZED", { walletAccountId: input.walletAccountId });

    conversationId = crypto.randomUUID();
    userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const prompt = "Please generate the cutest image of you.";

    const conversationWrite = await db.from("conversations").insert({
      id: conversationId,
      wallet_account_id: input.walletAccountId,
      title: "Temporary image pipeline test",
    }).select("id").single();
    if (conversationWrite.error || !conversationWrite.data) {
      if (conversationWrite.error) await persistImageDatabaseFailure({
        requestId: trace.requestId,
        operation: "chat_conversation",
        table: "conversations",
        error: conversationWrite.error,
        walletAccountId: input.walletAccountId,
      });
      trace.record("CHAT_MESSAGE_CREATED", { error: "DATABASE_INSERT_FAILED" });
      failureMessage = "The temporary test conversation could not be created.";
      return await finishAfterCleanup(false);
    }
    conversationCreated = true;

    const userWrite = await db.from("messages").insert({
      id: userMessageId,
      conversation_id: conversationId,
      role: "user",
      content: prompt,
      status: "complete",
      client_request_id: crypto.randomUUID(),
    }).select("id").single();
    if (userWrite.error || !userWrite.data) {
      if (userWrite.error) await persistImageDatabaseFailure({
        requestId: trace.requestId,
        operation: "chat_message_create",
        table: "messages",
        error: userWrite.error,
        walletAccountId: input.walletAccountId,
      });
      trace.record("CHAT_MESSAGE_CREATED", { error: "DATABASE_INSERT_FAILED" });
      failureMessage = "The temporary user message could not be saved.";
      return await finishAfterCleanup(false);
    }

    const assistantWrite = await db.from("messages").insert({
      id: assistantMessageId,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
    }).select("id").single();
    if (assistantWrite.error || !assistantWrite.data) {
      if (assistantWrite.error) await persistImageDatabaseFailure({
        requestId: trace.requestId,
        operation: "chat_message_create",
        table: "messages",
        error: assistantWrite.error,
        walletAccountId: input.walletAccountId,
      });
      trace.record("CHAT_MESSAGE_CREATED", { error: "DATABASE_INSERT_FAILED" });
      failureMessage = "The temporary assistant message could not be saved.";
      return await finishAfterCleanup(false);
    }
    trace.record("CHAT_MESSAGE_CREATED", { walletAccountId: input.walletAccountId, conversationId });

    const generated = await generateChatImage(prompt, {
      walletAccountId: input.walletAccountId,
      conversationId,
      messageId: userMessageId,
      conversationContext: [],
      ownerPreview: true,
      adminPipelineTest: true,
      trace,
    });
    checks.set("Configuration", stageState(trace, "IMAGE_CONFIG_RESOLVED"));
    const rowCreated = stageState(trace, "GENERATION_ROW_CREATED");
    checks.set("Database Insert", rowCreated);
    checks.set("API Key", stageState(trace, "TOGETHER_REQUEST_STARTED"));
    checks.set("Together", stageState(trace, "TOGETHER_RESPONSE_RECEIVED"));
    checks.set("Image Download", stageState(trace, "PROVIDER_IMAGE_FETCHED"));
    checks.set("Storage", stageState(trace, "SUPABASE_UPLOAD_COMPLETED"));
    checks.set("Database Update", stageState(trace, "GENERATION_ROW_UPDATED"));

    if (!generated.handled || generated.card.kind !== "IMAGE") {
      failureMessage = "Chat generation did not return a completed image.";
      return await finishAfterCleanup(false);
    }
    generationId = generated.card.generationId;

    const attached = await persistChatImageAttachment({
      walletAccountId: input.walletAccountId,
      conversationId,
      assistantMessageId,
      generationId,
      card: generated.card,
      content: generated.reply,
      metadata: {},
      trace,
    });
    checks.set("Message Attachment", attached ? "PASS" : "FAILED");
    checks.set("Message Persistence", attached ? "PASS" : "FAILED");
    if (!attached) {
      failureMessage = "The generated image could not be attached to the temporary chat.";
      return await finishAfterCleanup(false);
    }

    const conversationUpdate = await db.from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("wallet_account_id", input.walletAccountId);
    if (conversationUpdate.error) {
      await persistImageDatabaseFailure({
        requestId: trace.requestId,
        operation: "chat_conversation",
        table: "conversations",
        error: conversationUpdate.error,
        walletAccountId: input.walletAccountId,
      });
      failureMessage = "The temporary chat conversation could not be finalized.";
      return await finishAfterCleanup(false);
    }

    const [generationRead, messageRead] = await Promise.all([
      db.from("image_generations")
        .select("id,status,image_path,assistant_message_id")
        .eq("id", generationId)
        .eq("wallet_account_id", input.walletAccountId)
        .eq("conversation_id", conversationId)
        .maybeSingle(),
      db.from("messages")
        .select("id,role,content,status,metadata_json")
        .eq("id", assistantMessageId)
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .maybeSingle(),
    ]);
    const generation = generationRead.data as { id: string; status: string; image_path: string | null; assistant_message_id: string | null } | null;
    const message = messageRead.data as { id: string; role: string; content: string; status: string; metadata_json: Record<string, unknown> | null } | null;
    const storedMetadata = message?.metadata_json;
    const storedCard = storedMetadata?.actionCard as { kind?: string; generationId?: string; url?: string } | undefined;
    const recordIsDurable = Boolean(
      generation
      && generation.status === "COMPLETED"
      && generation.image_path
      && generation.assistant_message_id === assistantMessageId
      && message?.status === "complete"
      && storedCard?.kind === "IMAGE"
      && storedCard.generationId === generationId
      && storedCard.url === "",
    );

    if (recordIsDurable && message) {
      const reopened = await refreshStoredCards([message], input.walletAccountId);
      const reopenedMeta = reopened[0]?.metadata_json as { actionCard?: { kind?: string; url?: string } } | undefined;
      const freshUrl = reopenedMeta?.actionCard?.url;
      checks.set("Read Back", typeof freshUrl === "string" && /^https:\/\//iu.test(freshUrl) ? "PASS" : "FAILED");
      if (checks.get("Read Back") === "PASS") trace.record("CHAT_MESSAGE_PERSISTED");
    } else {
      checks.set("Read Back", "FAILED");
    }

    if (checks.get("Read Back") !== "PASS") {
      failureMessage = "The saved image attachment could not be reconstructed from the conversation.";
      return await finishAfterCleanup(false);
    }
    return await finishAfterCleanup(true, "Full chat image generation, persistence, signed-URL read-back, and cleanup verified.");
  } catch {
    failureMessage = "The full chat image pipeline failed unexpectedly.";
    return await finishAfterCleanup(false);
  }

  function finish(ok: boolean, message = failureMessage): FullChatImageTestResult {
    const allChecks = [...checks].map(([label, state]) => ({ label, state }));
    return { ok, message, checks: allChecks, diagnostics: trace.snapshot() };
  }

  async function finishAfterCleanup(ok: boolean, message = failureMessage): Promise<FullChatImageTestResult> {
    const cleaned = await cleanupTemporaryData({ db: db!, walletAccountId: input.walletAccountId, conversationId: conversationCreated ? conversationId : null, userMessageId, generationId }).catch(() => false);
    checks.set("Cleanup", cleaned ? "PASS" : "FAILED");
    const cleanupPassed = checks.get("Cleanup") === "PASS";
    const successful = ok && cleanupPassed;
    return finish(successful, successful ? message : cleanupPassed ? message : "The test ran, but temporary chat data could not be fully cleaned up.");
  }
}

async function cleanupTemporaryData(input: {
  db: NonNullable<ReturnType<typeof getServiceClient>>;
  walletAccountId: string;
  conversationId: string | null;
  userMessageId: string | null;
  generationId: string | null;
}): Promise<boolean> {
  let ok = true;
  let generation: { id: string; image_path: string | null } | null = null;
  if (input.generationId) {
    const result = await input.db.from("image_generations")
      .select("id,image_path")
      .eq("id", input.generationId)
      .eq("wallet_account_id", input.walletAccountId)
      .maybeSingle();
    if (result.error) ok = false;
    generation = result.data as { id: string; image_path: string | null } | null;
  } else if (input.conversationId && input.userMessageId) {
    const result = await input.db.from("image_generations")
      .select("id,image_path")
      .eq("wallet_account_id", input.walletAccountId)
      .eq("conversation_id", input.conversationId)
      .eq("message_id", input.userMessageId)
      .maybeSingle();
    if (result.error) ok = false;
    generation = result.data as { id: string; image_path: string | null } | null;
  }

  if (generation) {
    // Keep a test image from remaining quota-eligible if a later cleanup step
    // fails. A successful delete removes this temporary failure row as well.
    await input.db.from("image_generations")
      .update({ status: "FAILED", failure_code: "ADMIN_TEST_CLEANUP", failure_message: "Temporary admin test cleanup.", failed_at: new Date().toISOString() })
      .eq("id", generation.id)
      .eq("wallet_account_id", input.walletAccountId)
      .select("id")
      .maybeSingle();
    const objectRemoved = !generation.image_path || await deleteGenerationImage(generation.image_path).catch(() => false);
    if (!objectRemoved) {
      ok = false;
    } else {
      const removal = await input.db.from("image_generations")
        .delete()
        .eq("id", generation.id)
        .eq("wallet_account_id", input.walletAccountId)
        .select("id")
        .maybeSingle();
      if (removal.error || !removal.data) ok = false;
    }
  }

  if (input.conversationId) {
    const removal = await input.db.from("conversations")
      .delete()
      .eq("id", input.conversationId)
      .eq("wallet_account_id", input.walletAccountId)
      .select("id")
      .maybeSingle();
    if (removal.error || !removal.data) ok = false;
  }
  return ok;
}
