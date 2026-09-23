import { z } from "zod";

import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { createImageProvider } from "@/lib/image-generation/provider";
import { imageSettingsKey, parseImageSettings, readImageProviderConfig, readImageSettings, removeImageApiKey, writeImageSettings } from "@/lib/image-generation/settings";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["openai", "stability", "replicate", "custom"]),
  baseUrl: z.string().trim().max(2_000),
  model: z.string().trim().max(120),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16", "3:2", "2:3"]),
  defaultQuality: z.enum(["standard", "high"]),
  dailyLimit: z.number().int().min(1).max(100),
  allowGuestGeneration: z.boolean(),
  apiKey: z.string().trim().max(400).optional(),
  clearApiKey: z.boolean().optional(),
  action: z.enum(["save", "test"]),
});

/**
 * Admin image-generation settings.
 *
 * The API key is write-only. It is accepted here, encrypted with
 * APP_ENCRYPTION_KEY, and never returned: reads expose only `hasApiKey` and the
 * last four characters so an operator can confirm which key is in place.
 */
export async function GET() {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const settings = await readImageSettings();
  return Response.json({ settings }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session;


  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Those settings are not valid.", 400, "INVALID_INPUT");
  const { action, apiKey, clearApiKey, ...settings } = parsed.data;

  if (action === "test") {
    const stored = await readImageProviderConfig();
    const candidate = apiKey || stored?.apiKey;
    if (!candidate) return jsonError("Add an API key first.", 400, "NOT_CONFIGURED");
    const provider = createImageProvider({
      provider: settings.provider,
      apiKey: candidate,
      baseUrl: settings.baseUrl || undefined,
      model: settings.model || undefined,
      supportsReferenceImage: true,
    });
    const result = await provider.testConnection();
    await auditAdmin(request, admin.email, "image_settings.test", "image_settings", "singleton", result.ok ? "success" : "failure", { provider: settings.provider });
    return Response.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    await writeImageSettings(parseImageSettings(settings), admin.email, apiKey || undefined);
    if (clearApiKey) await removeImageApiKey();
  } catch (error) {
    const code = error instanceof Error ? error.message : "SAVE_FAILED";
    if (code === "ENCRYPTION_KEY_NOT_CONFIGURED") return jsonError("APP_ENCRYPTION_KEY is not configured, so the key cannot be stored securely.", 503, code);
    return jsonError("Those settings could not be saved.", 503, "SAVE_FAILED");
  }

  await auditAdmin(request, admin.email, "image_settings.save", "image_settings", "singleton", "success", {
    enabled: settings.enabled,
    provider: settings.provider,
    dailyLimit: settings.dailyLimit,
    // Never the key itself, only whether it changed.
    keyChanged: Boolean(apiKey),
    keyCleared: Boolean(clearApiKey),
  });

  return Response.json({ ok: true, settings: await readImageSettings(), key: imageSettingsKey }, { headers: { "Cache-Control": "private, no-store" } });
}