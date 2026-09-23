import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { DeepSeekProvider } from "@/lib/ai/deepseek";
import { getProviderConfig } from "@/lib/ai/config";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";

const testSchema = z.object({ apiKey: z.string().min(8).max(500).optional(), baseUrl: z.string().url().optional(), model: z.string().max(120).optional(), wireApi: z.enum(["chat-completions", "responses"]).optional() });

export async function POST(request: Request) {
  const auth = await adminOrResponse(); if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const limited = await checkRateLimit("admin.ai.test", auth.session!.email, 8, 10 * 60); if (!limited.allowed) return jsonError("Wait a little before testing again.", 429, "RATE_LIMITED");
  const parsed = testSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return jsonError("Invalid connection settings.", 400, "INVALID_INPUT");
  const stored = await getProviderConfig(); const apiKey = parsed.data.apiKey ?? stored?.apiKey; if (!apiKey) return jsonError("Add a DeepSeek API key first.", 400, "API_KEY_REQUIRED");
  const config = { apiKey, baseUrl: parsed.data.baseUrl ?? stored?.baseUrl ?? "https://api.deepseek.com", model: parsed.data.model || stored?.model, wireApi: parsed.data.wireApi ?? stored?.wireApi ?? "chat-completions" as const, temperature: stored?.temperature ?? .8, maxOutputTokens: stored?.maxOutputTokens ?? 1200, timeoutMs: Math.min(stored?.timeoutMs ?? 20_000, 30_000), retryCount: 0 };
  const report = await new DeepSeekProvider().testConnection(config);
  await auditAdmin(request, auth.session!.email, "ai.connection.test", "provider", "deepseek", report.ok ? "success" : "failure", { latencyMs: report.latencyMs, model: report.model });
  return Response.json(report, { status: report.ok ? 200 : 502, headers: { "Cache-Control": "private, no-store" } });
}
