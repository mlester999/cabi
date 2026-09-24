import "server-only";

import { buildCabiImagePrompt } from "@/lib/cabi/image-identity";
import { aspectRatioSizes, type AspectRatio, type ImageGenerationError, type ImageGenerationResult } from "@/lib/image-generation/types";

/**
 * Together AI image generation.
 *
 * Talks to the REST endpoint directly rather than adding an SDK dependency:
 * the request shape is small and stable, and one fewer package in the server
 * bundle is one fewer supply-chain surface for a credential-bearing path.
 *
 * The API key is read from the server environment only. It is never placed in a
 * response, never logged, and never sent to a browser — the error paths below
 * deliberately discard the provider's message text before it can reach a client.
 */

export const togetherImageEndpoint = "https://api.together.xyz/v1/images/generations";

/** The default image model. Overridable with TOGETHER_IMAGE_MODEL. */
export const defaultTogetherImageModel = "Qwen/Qwen-Image";

/** Only these three ratios are offered, so a request cannot ask for an extreme size. */
export const togetherAspectRatios: readonly AspectRatio[] = ["1:1", "16:9", "9:16"] as const;

/**
 * Sizes actually sent to Together, in the three supported ratios. The
 * application-level `aspectRatioSizes` is the single source for these numbers.
 */
export function sizeForAspectRatio(ratio: AspectRatio): { width: number; height: number } {
  const size = aspectRatioSizes[ratio] ?? aspectRatioSizes["1:1"];
  return { width: size.width, height: size.height };
}

export type TogetherRequest = {
  prompt: string;
  aspectRatio: AspectRatio;
  /** Seeds a reproducible result when supplied by the caller. */
  seed?: number;
  /**
   * Reference images for character consistency, when the selected model accepts
   * them. Qwen/Qwen-Image is text-to-image today, so this is passed through only
   * for models known to support it; see `supportsReferenceImages`.
   */
  referenceImages?: string[];
  /**
   * A prompt that already contains the Cabi character layers.
   *
   * The image pipeline assembles prompts from `lib/cabi/image-identity.ts` and
   * must not have them re-wrapped here. When this is absent the plain `prompt` is
   * wrapped with the identity, so no caller can reach Together with an unwrapped
   * prompt by accident.
   */
  preparedPrompt?: string;
};

export type TogetherProviderConfig = {
  apiKey: string;
  model?: string;
  /** Overridable for tests and for a Together-compatible proxy. */
  endpoint?: string;
  timeoutMs?: number;
};

/**
 * Whether the configured model accepts image inputs.
 *
 * Deliberately a small allowlist rather than an optimistic `true`: sending an
 * unsupported parameter would be inventing API surface, and the request would
 * fail at the provider instead of degrading to text-to-image.
 */
const referenceCapableModels: readonly string[] = [
  "Qwen/Qwen-Image-Edit",
  "black-forest-labs/FLUX.1-Kontext-pro",
  "black-forest-labs/FLUX.1-Kontext-max",
];

export function supportsReferenceImages(model: string): boolean {
  return referenceCapableModels.some((candidate) => candidate.toLowerCase() === model.toLowerCase());
}

/** How many inference steps to request. Qwen-Image is a step-distilled model. */
const defaultSteps = 28;

function classifyHttpError(status: number): { error: ImageGenerationError; message: string } {
  if (status === 401 || status === 403) {
    return { error: "NOT_CONFIGURED", message: "My image connection is not set up right. Tell the owner for me?" };
  }
  // 402 is Together's insufficient-balance response.
  if (status === 402) {
    return { error: "PROVIDER_ERROR", message: "I am out of image credits right now. The owner needs to top up." };
  }
  if (status === 429) {
    return { error: "RATE_LIMITED", message: "I am drawing a lot right now. Give me a moment and try again." };
  }
  if (status === 400 || status === 422) {
    return { error: "UNSAFE_PROMPT", message: "I could not draw that one. Try describing it differently?" };
  }
  if (status === 404) {
    return { error: "PROVIDER_ERROR", message: "My image model is unavailable right now." };
  }
  if (status >= 500) {
    return { error: "PROVIDER_ERROR", message: "The image service is having a moment. Try again shortly?" };
  }
  return { error: "PROVIDER_ERROR", message: "I could not draw that one just now." };
}

/**
 * Reads one image from a Together response.
 *
 * `response_format: "url"` is requested, so the normal shape carries a URL.
 * Some deployments return base64 instead; both are accepted rather than
 * assuming one, and anything else is reported as a malformed response.
 */
type TogetherPayload = { data?: Array<{ url?: unknown; b64_json?: unknown }> };

async function readImage(payload: TogetherPayload, signal: AbortSignal): Promise<Uint8Array | null> {
  const first = payload.data?.[0];
  if (!first) return null;

  if (typeof first.url === "string" && first.url.startsWith("https://")) {
    const response = await fetch(first.url, { signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > 128 ? new Uint8Array(buffer) : null;
  }

  if (typeof first.b64_json === "string" && first.b64_json.length > 64) {
    try {
      const binary = atob(first.b64_json);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return bytes.byteLength > 128 ? bytes : null;
    } catch {
      return null;
    }
  }

  return null;
}

/** Sniffs the real format rather than trusting a declared content type. */
function contentTypeOf(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "image/png";
}

export function resolveTogetherApiKey(): string | null {
  const key = process.env.TOGETHER_API_KEY?.trim();
  return key && key.length > 8 ? key : null;
}

export function resolveTogetherModel(): string {
  const model = process.env.TOGETHER_IMAGE_MODEL?.trim();
  return model && model.length > 0 ? model : defaultTogetherImageModel;
}

/**
 * Generates one Cabi image.
 *
 * The scene is wrapped with the canonical identity here rather than by the
 * caller, so no code path can reach Together with an unwrapped prompt.
 *
 * `n` is fixed at 1: the brief caps a request at a single image, and allowing
 * more would multiply cost per click.
 */
export async function generateTogetherImage(
  request: TogetherRequest,
  config?: Partial<TogetherProviderConfig>,
): Promise<ImageGenerationResult> {
  const apiKey = config?.apiKey ?? resolveTogetherApiKey();
  if (!apiKey) {
    return { ok: false, error: "NOT_CONFIGURED", message: "Cabi's image generation has not been configured yet." };
  }

  const model = config?.model ?? resolveTogetherModel();
  const { width, height } = sizeForAspectRatio(request.aspectRatio);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs ?? 120_000);

  try {
    const body: Record<string, unknown> = {
      model,
      prompt: request.preparedPrompt ?? buildCabiImagePrompt(request.prompt),
      n: 1,
      width,
      height,
      response_format: "url",
      steps: defaultSteps,
    };
    if (typeof request.seed === "number") body.seed = request.seed;
    // Only sent when the model is known to accept image inputs.
    if (request.referenceImages?.length && supportsReferenceImages(model)) {
      body.image_url = request.referenceImages[0];
    }

    const response = await fetch(config?.endpoint ?? togetherImageEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The provider's own text is read but never forwarded: it can name the
      // account, the model, or the key's prefix.
      const detail = await response.text().catch(() => "");
      console.error(`[cabi:image] together ${response.status} ${detail.slice(0, 200)}`);
      const classified = classifyHttpError(response.status);
      return { ok: false, ...classified };
    }

    const payload = await response.json().catch(() => null) as TogetherPayload | null;
    if (!payload) return { ok: false, error: "INVALID_RESPONSE", message: "The image service sent back something I could not read." };

    const bytes = await readImage(payload, controller.signal);
    if (!bytes) return { ok: false, error: "INVALID_RESPONSE", message: "I could not read the image that came back." };

    return {
      ok: true,
      image: {
        bytes,
        contentType: contentTypeOf(bytes),
        provider: "together",
        // The model name is internal; it is recorded on the row, not shown.
        model,
        width,
        height,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "TIMEOUT", message: "That took too long. Try again?" };
    }
    console.error(`[cabi:image] together request failed: ${error instanceof Error ? error.name : "unknown"}`);
    return { ok: false, error: "PROVIDER_ERROR", message: "I could not reach the image service." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Connection test for the admin panel.
 *
 * Uses the cheapest possible real call so a green result means the key, the
 * balance and the model all work — a key that authenticates but cannot generate
 * would otherwise pass.
 */
export async function testTogetherConnection(config?: Partial<TogetherProviderConfig>): Promise<
  { ok: true; model: string; message: string } | { ok: false; error: ImageGenerationError; message: string }
> {
  const apiKey = config?.apiKey ?? resolveTogetherApiKey();
  if (!apiKey) return { ok: false, error: "NOT_CONFIGURED", message: "Add your Together AI API key first." };
  const model = config?.model ?? resolveTogetherModel();

  const result = await generateTogetherImage({ prompt: "Cabi waving hello", aspectRatio: "1:1" }, { ...config, apiKey, model });
  if (!result.ok) return { ok: false, error: result.error, message: result.message };
  return { ok: true, model, message: `Connected. ${model} is responding.` };
}