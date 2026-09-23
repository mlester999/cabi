import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "@/lib/ai/deepseek";
import type { ProviderConfig } from "@/lib/ai/provider";

const config: ProviderConfig = { apiKey: "sk-test-secret", baseUrl: "https://api.deepseek.com", model: "model-a", wireApi: "chat-completions", temperature: .8, maxOutputTokens: 200, timeoutMs: 5000, retryCount: 0 };
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek provider", () => {
  it("lists models without exposing the API key in results", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), { status: 200, headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", mock);
    await expect(new DeepSeekProvider().listModels(config)).resolves.toEqual(["model-a", "model-b"]);
    expect((mock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test-secret" });
  });

  it("parses chat-completion streams split across byte boundaries", async () => {
    const encoder = new TextEncoder(); const frames = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: {"choices":[{"delta":{"content":" Mark"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'];
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(frames[0].slice(0, 17))); controller.enqueue(encoder.encode(frames[0].slice(17) + frames[1])); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const events = []; for await (const item of new DeepSeekProvider().stream({ messages: [{ role: "user", content: "hello" }] }, config)) events.push(item);
    expect(events.filter((item) => item.type === "text-delta").map((item) => item.type === "text-delta" ? item.text : "").join("")).toBe("Hi Mark");
    expect(events.at(-1)).toMatchObject({ type: "complete", finishReason: "stop" });
  });

  it("parses CRLF event boundaries even when the CRLF pair is split across chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\r'));
        controller.enqueue(encoder.encode('\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const events = [];
    for await (const item of new DeepSeekProvider().stream({ messages: [{ role: "user", content: "hello" }] }, config)) events.push(item);
    expect(events.filter((item) => item.type === "text-delta")).toEqual([{ type: "text-delta", text: "Hi" }]);
    expect(events.at(-1)).toMatchObject({ type: "complete", finishReason: "stop" });
  });

  it("rejects a stream that reaches EOF without a terminal event", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const consume = async () => {
      for await (const item of new DeepSeekProvider().stream({ messages: [{ role: "user", content: "hello" }] }, config)) void item;
    };
    await expect(consume()).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
  });

  it("keeps caller abort active after response headers arrive", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const controller = new AbortController();
    const iterator = new DeepSeekProvider().stream({ messages: [{ role: "user", content: "hello" }], signal: controller.signal }, config);
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "start" }, done: false });
    const pending = iterator.next();
    controller.abort(new DOMException("Stopped", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });

  it("returns sanitized connection failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret upstream body", { status: 401 })));
    const report = await new DeepSeekProvider().testConnection(config);
    expect(report.ok).toBe(false); expect(report.message).toBe("The DeepSeek API key was rejected."); expect(JSON.stringify(report)).not.toContain("sk-test-secret"); expect(JSON.stringify(report)).not.toContain("secret upstream body");
  });
});
