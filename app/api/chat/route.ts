import { DeepSeekProvider } from "@/lib/ai/deepseek";
import { getProviderConfig } from "@/lib/ai/config";
import { buildSystemMessages } from "@/lib/ai/prompts";
import type { TokenUsage } from "@/lib/ai/provider";
import { recordConversationBond } from "@/lib/bond";
import { getServiceClient } from "@/lib/db/supabase";
import { getCabiRuntimeConfig } from "@/lib/config/runtime";
import { retrieveRagContext } from "@/lib/knowledge/rag";
import { getConversationContext } from "@/lib/memory/context";
import { applyMemoryIntent } from "@/lib/memory/store";
import { maybeSummarizeConversation } from "@/lib/memory/summarizer";
import { assertSameOrigin, clientAddress, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { readGuestId } from "@/lib/security/session";
import { chatRequestSchema } from "@/lib/validation/api";

export const dynamic = "force-dynamic";

function event(name: string, data: unknown) { return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`; }

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("That request couldn't be verified.", 403, "INVALID_ORIGIN"); }
  const profileId = await readGuestId();
  if (!profileId) return jsonError("Start a Cabi session first.", 401, "SESSION_REQUIRED");
  const limited = await checkRateLimit("ai.chat", `${profileId}:${clientAddress(request)}`, 24, 60);
  if (!limited.allowed) return new Response(JSON.stringify({ error: "Slow down a tiny bit — I want to keep up.", code: "RATE_LIMITED" }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(limited.retryAfter), "Cache-Control": "private, no-store" } });
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("That message doesn't look right.", 400, "INVALID_MESSAGE");
  const config = await getProviderConfig().catch(() => null);
  if (!config) return jsonError("Cabi's AI connection hasn't been configured yet.", 503, "AI_NOT_CONFIGURED");

  const db = getServiceClient();
  let conversationId = parsed.data.conversationId ?? crypto.randomUUID();
  let userMessageId = crypto.randomUUID();
  let assistantMessageId = crypto.randomUUID();
  if (db) {
    if (parsed.data.conversationId) {
      const { data: owned } = await db.from("conversations").select("id").eq("id", conversationId).eq("user_id", profileId).maybeSingle();
      if (!owned) return jsonError("That conversation wasn't found.", 404, "CONVERSATION_NOT_FOUND");
    } else {
      const title = parsed.data.message.replace(/\s+/gu, " ").slice(0, 54) || "New chat";
      const { data: conversation, error } = await db.from("conversations").insert({ id: conversationId, user_id: profileId, title }).select("id").single();
      if (error || !conversation) return jsonError("Cabi couldn't start a new chat.", 503, "CONVERSATION_CREATE_FAILED");
      conversationId = conversation.id;
      if (parsed.data.onboardingName) await db.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: "Hey. What should I call you?", status: "complete", metadata_json: { onboarding: true } });
    }
    const { data: insertedUser, error: userError } = await db.from("messages").insert({ id: userMessageId, conversation_id: conversationId, role: "user", content: parsed.data.message, status: "complete", client_request_id: parsed.data.clientRequestId ?? crypto.randomUUID() }).select("id").single();
    if (userError || !insertedUser) return jsonError("Cabi couldn't save your message.", 503, "MESSAGE_SAVE_FAILED");
    userMessageId = insertedUser.id;
    const { data: insertedAssistant } = await db.from("messages").insert({ id: assistantMessageId, conversation_id: conversationId, role: "assistant", content: "", status: "streaming", retry_of_message_id: parsed.data.retryOfMessageId ?? null }).select("id").single();
    if (insertedAssistant) assistantMessageId = insertedAssistant.id;
    if (parsed.data.onboardingName && parsed.data.message.length <= 80) {
      const preferredName = parsed.data.message.replace(/^(?:you can )?call me\s+/iu, "").replace(/^(?:my name is|i am|i'm)\s+/iu, "").replace(/[^\p{L}\p{N}\-_' ]/gu, "").trim().split(/\s+/u).slice(0, 3).join(" ");
      if (preferredName) await db.from("profiles").update({ preferred_name: preferredName }).eq("id", profileId);
    }
  }

  const [context, rag, runtime] = await Promise.all([getConversationContext(profileId, conversationId), retrieveRagContext(parsed.data.message), getCabiRuntimeConfig()]);
  const recent = context.recent.some((message) => message.role === "user" && message.content === parsed.data.message) ? context.recent : [...context.recent, { role: "user" as const, content: parsed.data.message }];
  const prompt = [...buildSystemMessages({ nickname: context.nickname, mood: runtime.personality?.defaultMood ?? "cozy", persona: runtime.personality?.systemPrompt, memories: context.memories, summary: context.summary, trustedCpu: runtime.cpu, knowledge: rag.records }), ...recent];
  const provider = new DeepSeekProvider();
  const encoder = new TextEncoder();
  let cancelled = false;
  request.signal.addEventListener("abort", () => { cancelled = true; }, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let usage: TokenUsage | undefined;
      const started = Date.now();
      controller.enqueue(encoder.encode(event("meta", { conversationId, userMessageId, assistantMessageId, sources: rag.sources })));
      try {
        for await (const item of provider.stream({ messages: prompt, signal: request.signal }, config)) {
          if (item.type === "text-delta") { text += item.text; controller.enqueue(encoder.encode(event("delta", { text: item.text }))); }
          if (item.type === "usage") usage = item.usage;
        }
        if (db) {
          await Promise.all([
            db.from("messages").update({ content: text, status: "complete", metadata_json: { sources: rag.sources }, updated_at: new Date().toISOString() }).eq("id", assistantMessageId).eq("conversation_id", conversationId),
            db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", profileId),
            db.from("usage_logs").insert({ user_id: profileId, conversation_id: conversationId, provider: "deepseek", model: config.model ?? "auto", input_tokens: usage?.input ?? null, output_tokens: usage?.output ?? null, latency_ms: Date.now() - started, status: "success" }),
          ]);
        }
        const [memoryIntent, bond] = await Promise.all([
          context.memoryEnabled ? applyMemoryIntent(profileId, userMessageId, parsed.data.message) : Promise.resolve({ type: "none" as const }),
          recordConversationBond(profileId, conversationId),
          maybeSummarizeConversation(profileId, conversationId, provider, config).catch(() => false),
        ]);
        controller.enqueue(encoder.encode(event("done", { messageId: assistantMessageId, conversationId, sources: rag.sources, memoryIntent: memoryIntent.type, bond })));
      } catch {
        if (db) {
          await db.from("messages").update({ content: text, status: cancelled ? "cancelled" : "failed", updated_at: new Date().toISOString() }).eq("id", assistantMessageId).eq("conversation_id", conversationId);
          await db.from("usage_logs").insert({ user_id: profileId, conversation_id: conversationId, provider: "deepseek", model: config.model ?? "auto", latency_ms: Date.now() - started, status: cancelled ? "cancelled" : "failed" });
        }
        if (!cancelled) controller.enqueue(encoder.encode(event("error", { code: "AI_UNAVAILABLE", message: "Looks like my brain needs a second." })));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", Connection: "keep-alive", "X-Conversation-Id": conversationId, "X-Content-Type-Options": "nosniff" } });
}
