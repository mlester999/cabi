import "server-only";
import type { AIProvider, AIRequest, AIResult, AIStreamEvent, ConnectionReport, ProviderConfig, TokenUsage } from "@/lib/ai/provider";
import { AIProviderError } from "@/lib/ai/provider";

function endpoint(config: ProviderConfig, path: string) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== "https:" && base.hostname !== "localhost") throw new AIProviderError("INVALID_BASE_URL", "The AI base URL must use HTTPS.", false, 500);
  return new URL(path.replace(/^\//u, ""), `${base.toString().replace(/\/$/u, "")}/`).toString();
}

function headers(config: ProviderConfig) {
  return { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
}

function providerBody(request: AIRequest, config: ProviderConfig, stream: boolean, model: string) {
  if (config.wireApi === "responses") return { model, input: request.messages, stream, temperature: config.temperature, max_output_tokens: config.maxOutputTokens };
  return { model, messages: request.messages, stream, temperature: config.temperature, max_tokens: config.maxOutputTokens, stream_options: stream ? { include_usage: true } : undefined };
}

function providerPath(config: ProviderConfig) {
  return config.wireApi === "responses" ? "/responses" : "/chat/completions";
}

async function wait(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

async function fetchProvider(url: string, init: RequestInit, config: ProviderConfig, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Provider timed out", "TimeoutError")), config.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return response;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === config.retryCount) throw new AIProviderError("UPSTREAM_REJECTED", response.status === 401 ? "The DeepSeek API key was rejected." : "DeepSeek is unavailable right now.", retryable, response.status);
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(250 * 2 ** attempt + Math.random() * 150, 2000), signal);
    } catch (error) {
      lastError = error;
      if (error instanceof AIProviderError) throw error;
      if (signal?.aborted) throw error;
      if (attempt === config.retryCount) throw new AIProviderError("UPSTREAM_NETWORK_ERROR", "Cabi couldn't reach DeepSeek.", true);
      await wait(Math.min(250 * 2 ** attempt + Math.random() * 150, 2000), signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  throw lastError;
}

async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) yield { event, data };
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally { reader.releaseLock(); }
}

function usageFrom(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const input = Number(value.prompt_tokens ?? value.input_tokens);
  const output = Number(value.completion_tokens ?? value.output_tokens);
  const total = Number(value.total_tokens);
  return { input: Number.isFinite(input) ? input : undefined, output: Number.isFinite(output) ? output : undefined, total: Number.isFinite(total) ? total : undefined };
}

function outputText(payload: Record<string, unknown>, wireApi: ProviderConfig["wireApi"]) {
  if (wireApi === "chat-completions") {
    const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? "";
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = payload.output as Array<{ content?: Array<{ type?: string; text?: string }> }> | undefined;
  return output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("") ?? "";
}

export class DeepSeekProvider implements AIProvider {
  async listModels(config: ProviderConfig) {
    const response = await fetchProvider(endpoint(config, "/models"), { headers: headers(config), cache: "no-store" }, config);
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    return (payload.data ?? []).map((model) => typeof model.id === "string" ? model.id : "").filter(Boolean);
  }

  private async model(config: ProviderConfig) {
    if (config.model) return config.model;
    const models = await this.listModels(config);
    if (!models[0]) throw new AIProviderError("NO_MODEL_AVAILABLE", "DeepSeek returned no available models.", false, 503);
    return models[0];
  }

  async generate(request: AIRequest, config: ProviderConfig): Promise<AIResult> {
    const model = await this.model(config);
    const response = await fetchProvider(endpoint(config, providerPath(config)), { method: "POST", headers: headers(config), body: JSON.stringify(providerBody(request, config, false, model)), cache: "no-store" }, config, request.signal);
    const payload = await response.json() as Record<string, unknown>;
    return { text: outputText(payload, config.wireApi), model, usage: usageFrom(payload.usage), finishReason: String((payload.choices as Array<{ finish_reason?: string }> | undefined)?.[0]?.finish_reason ?? payload.status ?? "complete") };
  }

  async *stream(request: AIRequest, config: ProviderConfig): AsyncGenerator<AIStreamEvent> {
    const model = await this.model(config);
    const response = await fetchProvider(endpoint(config, providerPath(config)), { method: "POST", headers: { ...headers(config), Accept: "text/event-stream" }, body: JSON.stringify(providerBody(request, config, true, model)), cache: "no-store" }, config, request.signal);
    if (!response.body) throw new AIProviderError("EMPTY_STREAM", "DeepSeek returned an empty stream.");
    yield { type: "start", model };
    let finishReason: string | undefined;
    for await (const frame of readSse(response.body)) {
      if (frame.data === "[DONE]") break;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(frame.data) as Record<string, unknown>; } catch { continue; }
      if (config.wireApi === "chat-completions") {
        const choice = (payload.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined)?.[0];
        if (choice?.delta?.content) yield { type: "text-delta", text: choice.delta.content };
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const usage = usageFrom(payload.usage);
        if (usage) yield { type: "usage", usage };
      } else {
        const eventName = frame.event ?? String(payload.type ?? "");
        const delta = payload.delta;
        if ((eventName.includes("output_text.delta") || payload.type === "response.output_text.delta") && typeof delta === "string") yield { type: "text-delta", text: delta };
        if (eventName.includes("completed") || payload.type === "response.completed") {
          const responsePayload = payload.response as Record<string, unknown> | undefined;
          const usage = usageFrom(responsePayload?.usage);
          if (usage) yield { type: "usage", usage };
          finishReason = "complete";
        }
        if (eventName.includes("failed") || eventName.includes("incomplete")) throw new AIProviderError("UPSTREAM_INCOMPLETE", "DeepSeek couldn't finish that response.", true);
      }
    }
    yield { type: "complete", finishReason };
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionReport> {
    const started = Date.now();
    try {
      const models = await this.listModels(config);
      return { ok: true, latencyMs: Date.now() - started, models, model: config.model ?? models[0], message: models.length ? "Connected to DeepSeek." : "Connected, but no models were returned." };
    } catch (error) {
      const message = error instanceof AIProviderError ? error.message : "DeepSeek connection failed.";
      return { ok: false, latencyMs: Date.now() - started, message };
    }
  }
}
