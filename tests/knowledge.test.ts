import { describe, expect, it } from "vitest";
import { chunkKnowledgeText } from "@/lib/knowledge/chunker";
import { parsePublicHtml } from "@/lib/knowledge/parser";
import { defaultClankPolicy, normalizePublicUrl } from "@/lib/knowledge/url-policy";

describe("knowledge ingestion", () => {
  it("allows same-domain public pages and normalizes trackers", () => {
    expect(normalizePublicUrl("/create?utm_source=x&z=2", defaultClankPolicy)).toBe("https://clank.trade/create?z=2");
  });

  it("rejects external, credentialed, local, and non-HTTPS URLs", () => {
    expect(() => normalizePublicUrl("https://evil.example/", defaultClankPolicy)).toThrow("HOST_NOT_ALLOWED");
    expect(() => normalizePublicUrl("https://user:pass@clank.trade/", defaultClankPolicy)).toThrow("URL_CREDENTIALS_FORBIDDEN");
    expect(() => normalizePublicUrl("http://clank.trade/", defaultClankPolicy)).toThrow("HTTPS_REQUIRED");
  });

  it("strips scripts and navigation while preserving source links", () => {
    const parsed = parsePublicHtml(`<html><head><title>Clank</title><script>ignore me</script></head><body><nav>Menu</nav><main><h1>Launch coins</h1><p>Create an AI coin with an image and ticker.</p><a href="/create">Create</a></main></body></html>`);
    expect(parsed.title).toBe("Clank"); expect(parsed.text).toContain("Launch coins"); expect(parsed.text).not.toContain("ignore me"); expect(parsed.links).toContain("/create");
  });

  it("produces stable, bounded, overlapping chunks", async () => {
    const text = Array.from({ length: 30 }, (_, index) => `Section ${index}\n\n${"Useful public information ".repeat(30)}`).join("\n\n");
    const chunks = await chunkKnowledgeText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(2); expect(chunks[0].hash).toBeTruthy(); expect(chunks.every((chunk, index) => chunk.index === index && chunk.tokenEstimate > 0)).toBe(true);
  });
});
