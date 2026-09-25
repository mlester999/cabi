import "server-only";
import { chunkKnowledgeText } from "@/lib/knowledge/chunker";
import { parsePublicHtml } from "@/lib/knowledge/parser";
import { defaultClankPolicy, isCrawlablePath, normalizePublicUrl, type UrlPolicy } from "@/lib/knowledge/url-policy";
import { getServiceClient } from "@/lib/db/supabase";
import { hashValue } from "@/lib/security/crypto";

type CrawlOptions = { policy?: UrlPolicy; signal?: AbortSignal; onProgress?: (value: { pages: number; queued: number; url: string }) => void };
type FetchResult = { url: string; html: string; title: string; text: string; links: string[] };

function robotsAllowed(robots: string, path: string) {
  let applies = false;
  for (const rawLine of robots.split(/\r?\n/u)) {
    const line = rawLine.split("#")[0].trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (field?.toLowerCase() === "user-agent") applies = value === "*";
    if (applies && field?.toLowerCase() === "disallow" && value && path.startsWith(value)) return false;
  }
  return true;
}

async function fetchPage(url: string, policy: UrlPolicy, signal?: AbortSignal): Promise<FetchResult> {
  let current = normalizePublicUrl(url, policy);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await fetch(current, { redirect: "manual", signal, headers: { "User-Agent": "CabiKnowledgeBot/1.0 (+https://www.chatwithcabi.fun)", Accept: "text/html,text/plain;q=0.8" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
      current = normalizePublicUrl(location, policy, current);
      continue;
    }
    if (!response.ok) throw new Error(`FETCH_${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("UNSUPPORTED_CONTENT_TYPE");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > policy.maxBytes) throw new Error("PAGE_TOO_LARGE");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > policy.maxBytes) throw new Error("PAGE_TOO_LARGE");
    const html = new TextDecoder().decode(buffer);
    const parsed = parsePublicHtml(html);
    return { url: current, html, ...parsed };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

export async function crawlClankTrade(options: CrawlOptions = {}) {
  const policy = options.policy ?? defaultClankPolicy;
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const root = normalizePublicUrl(policy.rootUrl, policy);
  let robots = "";
  try { robots = await (await fetch(new URL("/robots.txt", root), { signal: options.signal, headers: { "User-Agent": "CabiKnowledgeBot/1.0" } })).text(); } catch { robots = ""; }
  const queue: Array<{ url: string; depth: number }> = [{ url: root, depth: 0 }];
  const seen = new Set<string>();
  const errors: Array<{ url: string; error: string }> = [];
  let indexed = 0;
  let chunksIndexed = 0;
  const { data: run, error: runError } = await db.from("knowledge_sync_runs").insert({ source: root, status: "running" }).select("id").single();
  if (runError) throw new Error("SYNC_RUN_CREATE_FAILED");
  try {
    while (queue.length && indexed < policy.maxPages) {
      const next = queue.shift()!;
      if (seen.has(next.url)) continue;
      seen.add(next.url);
      if (!robotsAllowed(robots, new URL(next.url).pathname)) { errors.push({ url: next.url, error: "ROBOTS_DISALLOWED" }); continue; }
      options.onProgress?.({ pages: indexed, queued: queue.length, url: next.url });
      try {
        const page = await fetchPage(next.url, policy, options.signal);
        if (page.text.length < 80) throw new Error("NO_EXTRACTABLE_TEXT");
        const contentHash = await hashValue(page.text);
        const { data: existing } = await db.from("knowledge_documents").select("id,content_hash").eq("canonical_url", page.url).maybeSingle();
        let documentId = existing?.id as string | undefined;
        if (existing?.content_hash !== contentHash) {
          const { data: document, error: documentError } = await db.from("knowledge_documents").upsert({ canonical_url: page.url, source_url: page.url, title: page.title, content: page.text, content_hash: contentHash, fetched_at: new Date().toISOString(), status: "active" }, { onConflict: "canonical_url" }).select("id").single();
          if (documentError) throw new Error("DOCUMENT_WRITE_FAILED");
          documentId = document.id;
          const chunks = await chunkKnowledgeText(page.text);
          await db.from("knowledge_chunks").delete().eq("document_id", documentId);
          if (chunks.length) {
            const { error: chunkError } = await db.from("knowledge_chunks").insert(chunks.map((chunk) => ({ document_id: documentId, chunk_index: chunk.index, content: chunk.content, content_hash: chunk.hash, token_estimate: chunk.tokenEstimate, metadata_json: { heading: chunk.heading } })));
            if (chunkError) throw new Error("CHUNK_WRITE_FAILED");
          }
          chunksIndexed += chunks.length;
        } else await db.from("knowledge_documents").update({ fetched_at: new Date().toISOString(), status: "active" }).eq("id", documentId);
        indexed += 1;
        if (next.depth < policy.maxDepth) for (const href of page.links) {
          try { const normalized = normalizePublicUrl(href, policy, page.url); if (!seen.has(normalized) && isCrawlablePath(normalized)) queue.push({ url: normalized, depth: next.depth + 1 }); } catch { /* External and malformed links are intentionally ignored. */ }
        }
      } catch (error) { errors.push({ url: next.url, error: error instanceof Error ? error.message : "UNKNOWN" }); }
    }
    await db.from("knowledge_sync_runs").update({ status: errors.length && indexed === 0 ? "failed" : "complete", pages_indexed: indexed, chunks_indexed: chunksIndexed, errors_json: errors, completed_at: new Date().toISOString() }).eq("id", run.id);
    return { runId: run.id, pagesIndexed: indexed, chunksIndexed, errors, status: errors.length && indexed === 0 ? "failed" : "complete" };
  } catch (error) {
    await db.from("knowledge_sync_runs").update({ status: "failed", errors_json: [{ error: error instanceof Error ? error.message : "UNKNOWN" }], completed_at: new Date().toISOString() }).eq("id", run.id);
    throw error;
  }
}
