import { z } from "zod";

import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { buildCabiGenerationPlan } from "@/lib/image-generation/plan.server";
import { createImageProvider, imageCapabilitiesFor } from "@/lib/image-generation/provider";
import {
  IMAGE_PROVIDER_OPTIONS,
  imageModelsForProvider,
  isImageModelForProvider,
  isSupportedImageProvider,
} from "@/lib/image-generation/registry";
import {
  imageSettingsKey,
  parseImageSettings,
  readImageProviderConfig,
  readImageSettings,
  removeImageApiKey,
  writeImageSettings,
} from "@/lib/image-generation/settings";
import type { ImageGenerationSettings } from "@/lib/image-generation/types";
import { assertSameOrigin, jsonError } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * The browser can select only catalog entries. In particular, it cannot send a
 * base URL: Together's official endpoint is an adapter invariant.
 */
export const imageAdminSaveSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(120),
  defaultAspectRatio: z.enum(["1:1", "16:9", "9:16"]),
  defaultQuality: z.enum(["standard", "high"]),
  dailyLimit: z.number().int().min(1).max(100),
  allowGuestGeneration: z.boolean(),
  apiKey: z.string().trim().max(400).optional(),
  clearApiKey: z.boolean().optional(),
  action: z.enum(["save", "test"]),
}).strict().superRefine((value, context) => {
  if (!isSupportedImageProvider(value.provider)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provider"], message: "Choose a supported image provider." });
  }
  if (!isImageModelForProvider(value.provider, value.model)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Choose a model from the selected provider." });
  }
});

type AdminImageSettings = Omit<ImageGenerationSettings, "baseUrl">;

function adminSettings(settings: ImageGenerationSettings): AdminImageSettings {
  const { baseUrl, ...safe } = settings;
  void baseUrl;
  return safe;
}

function catalog() {
  return {
    providers: IMAGE_PROVIDER_OPTIONS,
    models: imageModelsForProvider("together"),
  };
}

function responseHeaders() {
  return { "Cache-Control": "private, no-store" };
}

/** Admin image-generation settings. The endpoint and decrypted key stay server-side. */
export async function GET() {
  // This is an owner surface, not a public app API. The admin session is the
  // authorization and remains usable during PRELAUNCH/MAINTENANCE.
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const settings = await readImageSettings();
  return Response.json({ settings: adminSettings(settings), ...catalog() }, { headers: responseHeaders() });
}

const connectionTestPrompt = "Cabi smiling in a cozy room wearing her lavender CPU shirt.";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session;

  const parsed = imageAdminSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a provider and model from the available options.", 400, "INVALID_INPUT");
  const { action, apiKey, clearApiKey, ...settings } = parsed.data;

  if (action === "test") {
    const stored = await readImageProviderConfig();
    const candidate = apiKey || stored?.apiKey;
    if (!candidate) return jsonError("Add a Together AI API key first.", 400, "NOT_CONFIGURED");

    const capabilities = imageCapabilitiesFor({ provider: settings.provider as "together", model: settings.model });
    const planned = await buildCabiGenerationPlan({
      scene: connectionTestPrompt,
      aspectRatio: "1:1",
      modelSupportsReferenceImages: capabilities.supportsReferenceImages,
    });
    if (!planned.ok) return jsonError(planned.message, 503, planned.reason);

    const provider = createImageProvider({
      provider: settings.provider as "together",
      apiKey: candidate,
      model: settings.model,
      supportsReferenceImage: capabilities.supportsReferenceImages,
      capabilities,
    });
    const result = await provider.testConnection({
      referenceImages: planned.plan.referenceImages,
      preparedPrompt: planned.plan.prompt,
    });
    await auditAdmin(request, admin.email, "image_settings.test", "image_settings", "singleton", result.ok ? "success" : "failure", {
      provider: settings.provider,
      model: settings.model,
      referenceConditioning: planned.plan.capabilities.referenceConditioning,
    });
    return Response.json(
      result.ok
        ? { ...result, capabilities, referenceConditioning: planned.plan.capabilities.referenceConditioning }
        : result,
      { status: result.ok ? 200 : 400, headers: responseHeaders() },
    );
  }

  try {
    // `parseImageSettings` applies the official Together endpoint internally.
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
    model: settings.model,
    dailyLimit: settings.dailyLimit,
    // Never the key itself, only whether it changed.
    keyChanged: Boolean(apiKey),
    keyCleared: Boolean(clearApiKey),
  });

  const saved = await readImageSettings();
  return Response.json({ ok: true, settings: adminSettings(saved), ...catalog(), key: imageSettingsKey }, { headers: responseHeaders() });
}
