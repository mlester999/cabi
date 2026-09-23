import { DeepSeekProvider } from "@/lib/ai/deepseek";
import { getProviderConfig } from "@/lib/ai/config";
import { buildSystemMessages } from "@/lib/ai/prompts";
import type { TokenUsage } from "@/lib/ai/provider";
import { bondFromPoints, recordConversationBond } from "@/lib/bond";
import { getServiceClient } from "@/lib/db/supabase";
import { getCabiRuntimeConfig } from "@/lib/config/runtime";
import { retrieveRagContext } from "@/lib/knowledge/rag";
import { getConversationContext } from "@/lib/memory/context";
import { applyMemoryIntent } from "@/lib/memory/store";
import { maybeSummarizeConversation } from "@/lib/memory/summarizer";
import { assertSameOrigin, clientAddress, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { chatRequestSchema } from "@/lib/validation/api";
import { readWalletAuth } from "@/lib/wallet/session";
import { shouldPersistChat } from "@/lib/wallet/persistence";
import { guardAppApi } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

function event(name: string, data: unknown) { return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`; }

export async function POST(request: Request) {
  // Site mode is checked before anything else: while the site is in PRELAUNCH
  // or MAINTENANCE, this endpoint does not exist for a normal visitor. Admins
  // reach it through the explicit /preview opt-in.
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("That request couldn't be verified.", 403, "INVALID_ORIGIN"); }
  let wallet;
  try {
    wallet = await readWalletAuth();
  } catch {
    return jsonError("Wallet sign-in is temporarily unavailable. Your message was not sent.", 503, "WALLET_AUTH_UNAVAILABLE");
  }
  const rateSubject = wallet?.walletAccountId ?? clientAddress(request);
  const limited = await checkRateLimit("ai.chat", `${rateSubject}:${clientAddress(request)}`, 24, 60);
  if (!limited.allowed) return new Response(JSON.stringify({ error: "Slow down a tiny bit — I want to keep up.", code: "RATE_LIMITED" }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limited.retryAfter), "Cache-Control": "private, no-store" } });
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("That message doesn't look right.", 400, "INVALID_MESSAGE");
  const config = await getProviderConfig().catch(() => null);
  if (!config) return jsonError("Cabi's AI connection hasn't been configured yet.", 503, "AI_NOT_CONFIGURED");

  // Authentication enables persistence, but an explicitly temporary chat stays
  // browser-only even if the user connects in the middle of it.
  const persistent = shouldPersistChat(wallet?.walletAccountId, parsed.data.persist);
  const walletAccountId = persistent ? wallet!.walletAccountId : null;
  const profileId = persistent ? wallet!.profileId : null;
  const db = persistent ? getServiceClient() : null;
  if (persistent && !db) return jsonError("Persistence isn't configured.", 503, "DATABASE_NOT_CONFIGURED");
  let conversationId = parsed.data.conversationId ?? crypto.randomUUID();
  let userMessageId = crypto.randomUUID();
  let assistantMessageId = crypto.randomUUID();
  let createdConversation = false;
  if (db && walletAccountId && profileId) {
    if (parsed.data.conversationId) {
      const { data: owned } = await db.from("conversations").select("id").eq("id", conversationId).eq("wallet_account_id", walletAccountId).maybeSingle();
      if (!owned) return jsonError("That conversation wasn't found.", 404, "CONVERSATION_NOT_FOUND");
    } else {
      const title = parsed.data.message.replace(/\s+/gu, " ").slice(0, 54) || "New chat";
      const { data: conversation, error } = await db.from("conversations").insert({ id: conversationId, wallet_account_id: walletAccountId, title }).select("id").single();
      if (error || !conversation) return jsonError("Cabi couldn't start a new chat.", 503, "CONVERSATION_CREATE_FAILED");
      conversationId = conversation.id;
      createdConversation = true;
      if (parsed.data.onboardingName) {
        const { error: onboardingError } = await db.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: "Hey. What should I call you?", status: "complete", metadata_json: { onboarding: true } });
        if (onboardingError) {
          await db.from("conversations").delete().eq("id", conversationId).eq("wallet_account_id", walletAccountId);
          return jsonError("Cabi couldn't save the start of that chat.", 503, "MESSAGE_SAVE_FAILED");
        }
      }
    }
    if (parsed.data.retryOfMessageId) {
      const { data: retryTarget } = await db.from("messages").select("id").eq("id", parsed.data.retryOfMessageId).eq("conversation_id", conversationId).maybeSingle();
      if (!retryTarget) return jsonError("That message can't be retried.", 404, "RETRY_MESSAGE_NOT_FOUND");
    }
    const { data: insertedUser, error: userError } = await db.from("messages").insert({ id: userMessageId, conversation_id: conversationId, role: "user", content: parsed.data.message, status: "complete", client_request_id: parsed.data.clientRequestId ?? crypto.randomUUID() }).select("id").single();
    if (userError || !insertedUser) {
      if (createdConversation) await db.from("conversations").delete().eq("id", conversationId).eq("wallet_account_id", walletAccountId);
      return jsonError("Cabi couldn't save your message.", 503, "MESSAGE_SAVE_FAILED");
    }
    userMessageId = insertedUser.id;
    const { data: insertedAssistant, error: assistantError } = await db.from("messages").insert({ id: assistantMessageId, conversation_id: conversationId, role: "assistant", content: "", status: "streaming", retry_of_message_id: parsed.data.retryOfMessageId ?? null }).select("id").single();
    if (assistantError || !insertedAssistant) {
      if (createdConversation) await db.from("conversations").delete().eq("id", conversationId).eq("wallet_account_id", walletAccountId);
      else await db.from("messages").delete().eq("id", userMessageId).eq("conversation_id", conversationId);
      return jsonError("Cabi couldn't reserve the reply in your saved chat.", 503, "MESSAGE_SAVE_FAILED");
    }
    assistantMessageId = insertedAssistant.id;
    if (parsed.data.onboardingName && parsed.data.message.length <= 80) {
      const preferredName = parsed.data.message.replace(/^(?:you can )?call me\s+/iu, "").replace(/^(?:my name is|i am|i'm)\s+/iu, "").replace(/[^\p{L}\p{N}\-_' ]/gu, "").trim().split(/\s+/u).slice(0, 3).join(" ");
      if (preferredName) await db.from("profiles").update({ preferred_name: preferredName }).eq("id", profileId);
    }
  }

  const emptyContext = { recent: [], summary: null, memories: [], nickname: null, memoryEnabled: false };
  const [context, rag, runtime] = await Promise.all([
    walletAccountId && profileId ? getConversationContext(walletAccountId, profileId, conversationId) : Promise.resolve(emptyContext),
    retrieveRagContext(parsed.data.message),
    getCabiRuntimeConfig(),
  ]);
  const configuredNetwork = parsed.data.chainId == null
    ? null
    : runtime.publicWallet.chains.find((chain) => chain.enabled && chain.id === parsed.data.chainId)?.name ?? null;
  const localRecent = persistent ? context.recent : (parsed.data.guestHistory ?? []);
  const last = localRecent.at(-1);
  const recent = last?.role === "user" && last.content === parsed.data.message
    ? localRecent
    : [...localRecent, { role: "user" as const, content: parsed.data.message }];
  const prompt = [...buildSystemMessages({
    nickname: context.nickname,
    mood: runtime.personality?.defaultMood ?? "cozy",
    persona: runtime.personality?.systemPrompt,
    memories: context.memories,
    summary: context.summary,
    trustedCpu: runtime.cpu,
    walletAddress: wallet?.walletAddress ?? null,
    networkName: configuredNetwork,
    knowledge: rag.records,
  }), ...recent];
  const provider = new DeepSeekProvider();
  const encoder = new TextEncoder();
  let cancelled = false;
  request.signal.addEventListener("abort", () => { cancelled = true; }, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let usage: TokenUsage | undefined;
      const started = Date.now();
      controller.enqueue(encoder.encode(event("meta", { conversationId, userMessageId, assistantMessageId, sources: rag.sources, persistent })));
      try {
        for await (const item of provider.stream({ messages: prompt, signal: request.signal }, config)) {
          if (item.type === "text-delta") { text += item.text; controller.enqueue(encoder.encode(event("delta", { text: item.text }))); }
          if (item.type === "usage") usage = item.usage;
        }
        if (db && walletAccountId && profileId) {
          const [messageWrite, conversationWrite] = await Promise.all([
            db.from("messages").update({ content: text, status: "complete", metadata_json: { sources: rag.sources }, updated_at: new Date().toISOString() }).eq("id", assistantMessageId).eq("conversation_id", conversationId),
            db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("wallet_account_id", walletAccountId),
          ]);
          if (messageWrite.error || conversationWrite.error) throw new Error("PERSISTENCE_WRITE_FAILED");
          // Usage logging is telemetry, not conversation durability. A logging
          // outage must not turn a correctly saved reply into a failed chat.
          await db.from("usage_logs").insert({ user_id: profileId, wallet_account_id: walletAccountId, conversation_id: conversationId, provider: "deepseek", model: config.model ?? "auto", input_tokens: usage?.input ?? null, output_tokens: usage?.output ?? null, latency_ms: Date.now() - started, status: "success" });
        }
        const [memoryIntent, bond] = walletAccountId ? await Promise.all([
          context.memoryEnabled ? applyMemoryIntent(walletAccountId, userMessageId, parsed.data.message) : Promise.resolve({ type: "none" as const }),
          recordConversationBond(walletAccountId, conversationId),
          context.memoryEnabled ? maybeSummarizeConversation(walletAccountId, conversationId, provider, config).catch(() => false) : Promise.resolve(false),
        ]) : [{ type: "none" as const }, bondFromPoints(0)];
        controller.enqueue(encoder.encode(event("done", { messageId: assistantMessageId, conversationId, sources: rag.sources, memoryIntent: memoryIntent.type, bond, persistent })));
      } catch {
        if (db && walletAccountId && profileId) {
          await db.from("messages").update({ content: text, status: cancelled ? "cancelled" : "failed", updated_at: new Date().toISOString() }).eq("id", assistantMessageId).eq("conversation_id", conversationId);
          await db.from("usage_logs").insert({ user_id: profileId, wallet_account_id: walletAccountId, conversation_id: conversationId, provider: "deepseek", model: config.model ?? "auto", latency_ms: Date.now() - started, status: cancelled ? "cancelled" : "failed" });
        }
        if (!cancelled) controller.enqueue(encoder.encode(event("error", { code: "AI_UNAVAILABLE", message: "Looks like my brain needs a second." })));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", Connection: "keep-alive", "X-Conversation-Id": conversationId, "X-Content-Type-Options": "nosniff" } });
}
