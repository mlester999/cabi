export type SseEvent = { event: string; data: unknown };

export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
        const text = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (text) {
          let data: unknown = text;
          try { data = JSON.parse(text); } catch { /* Text data is valid SSE. */ }
          yield { event, data };
        }
        index = buffer.indexOf("\n\n");
      }
    }
  } finally { reader.releaseLock(); }
}
