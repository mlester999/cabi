import "server-only";
import { publicAppUrl } from "@/lib/config/env";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) throw new Error("CROSS_SITE_REQUEST");
  if (!origin) return;
  const expected = new URL(publicAppUrl()).origin;
  const current = new URL(request.url).origin;
  if (origin !== expected && origin !== current) throw new Error("INVALID_ORIGIN");
}

export function jsonError(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "local";
}
