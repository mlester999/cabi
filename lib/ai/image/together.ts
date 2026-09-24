import "server-only";

import { buildCabiImagePrompt } from "@/lib/cabi/image-identity";
import { imageModelFor, recommendedImageModel } from "@/lib/image-generation/registry";
import {
  aspectRatioSizes,
  type AspectRatio,
  type ImageConnectionDiagnostics,
  type ImageConnectionTest,
  type ImageGenerationError,
  type ImageGenerationResult,
} from "@/lib/image-generation/types";

/**
 * Together AI image generation.
 *
 * Talks to the REST endpoint directly rather than adding an SDK dependency:
 * the request shape is small and stable, and one fewer package in the server
 * bundle is one fewer supply-chain surface for a credential-bearing path.
 *
 * The API key is supplied by the server-side settings resolver or environment
 * fallback. It is never placed in a response, never logged, and never sent to a
 * browser — provider response text is deliberately discarded before it can
 * reach a client.
 */

export const togetherImageEndpoint = "https://api.together.xyz/v1/images/generations";

/** The recommended Together model for Cabi's generation and reference workflow. */
export const defaultTogetherImageModel = recommendedImageModel("together").id;

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
  /** Reference images for character consistency, when the selected model accepts them. */
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
  /** Server-built test inputs; never accepted from a user generation request. */
  referenceImages?: string[];
  preparedPrompt?: string;
};

export function supportsReferenceImages(model: string): boolean {
  return imageModelFor("together", model)?.supportsReferenceImages === true;
}

/** How many inference steps to request. Qwen-Image is a step-distilled model. */
const defaultSteps = 28;

export function classifyTogetherHttpError(status: number): { error: ImageGenerationError; message: string } {
  if (status === 401) return { error: "NOT_CONFIGURED", message: "Authentication failed" };
  if (status === 402) return { error: "PROVIDER_ERROR", message: "Insufficient credits or billing issue" };
  if (status === 403) return { error: "PROVIDER_ERROR", message: "Permission or account restriction" };
  if (status === 404) return { error: "PROVIDER_ERROR", message: "Model or endpoint unavailable" };
  if (status === 429) return { error: "RATE_LIMITED", message: "Rate limited" };
  if (status === 400 || status === 422) {
    return { error: "UNSAFE_PROMPT", message: "I could not draw that one. Try describing it differently?" };
  }
  if (status >= 500) return { error: "PROVIDER_ERROR", message: "Together AI service unavailable" };
  return { error: "PROVIDER_ERROR", message: "Together AI request failed" };
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
  return key || null;
}

/** Ensures the wire header has exactly one Bearer prefix without rewriting storage. */
export function togetherAuthorizationHeader(apiKey: string): string {
  let key = apiKey.trim();
  while (/^Bearer\s+/iu.test(key)) key = key.replace(/^Bearer\s+/iu, "");
  return `Bearer ${key}`;
}

export function resolveTogetherModel(): string {
  const model = process.env.TOGETHER_IMAGE_MODEL?.trim();
  return model && imageModelFor("together", model)?.id ? model : recommendedImageModel("together").id;
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
  const apiKey = config?.apiKey?.trim() || resolveTogetherApiKey();
  if (!apiKey) {
    return { ok: false, error: "NOT_CONFIGURED", message: "Cabi's image generation has not been configured yet." };
  }

  const model = config?.model && imageModelFor("together", config.model)?.id
    ? config.model
    : resolveTogetherModel();
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
        Authorization: togetherAuthorizationHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const classified = classifyTogetherHttpError(response.status);
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
  ImageConnectionTest
> {
  const endpoint = config?.endpoint ?? togetherImageEndpoint;
  const apiKey = config?.apiKey?.trim() || resolveTogetherApiKey();
  const diagnostics = (httpStatus: number | null, loadedKey: string | null): ImageConnectionDiagnostics => ({
    provider: "Together AI",
    endpoint,
    keyLoaded: Boolean(loadedKey),
    keySuffix: loadedKey ? loadedKey.slice(-4) : null,
    httpStatus,
  });

  if (!apiKey) {
    return {
      ok: false,
      error: "NOT_CONFIGURED",
      message: "Together AI key is not configured",
      diagnostics: diagnostics(null, null),
    };
  }
  const model = config?.model && imageModelFor("together", config.model)?.id
    ? config.model
    : resolveTogetherModel();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs ?? 30_000);
  try {
    // This is deliberately a minimal real generation request. It proves the
    // exact Together key can authenticate and generate without involving the
    // Cabi reference pipeline or any OpenAI-compatible route.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: togetherAuthorizationHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: "Cabi connection test",
        width: 512,
        height: 512,
        n: 1,
        response_format: "url",
      }),
      signal: controller.signal,
    });
    const responseDiagnostics = diagnostics(response.status, apiKey);
    if (!response.ok) {
      return { ok: false, ...classifyTogetherHttpError(response.status), diagnostics: responseDiagnostics };
    }

    const payload = await response.json().catch(() => null) as TogetherPayload | null;
    const first = payload?.data?.[0];
    if (!first || (typeof first.url !== "string" && typeof first.b64_json !== "string")) {
      return {
        ok: false,
        error: "INVALID_RESPONSE",
        message: "Together AI sent back an unreadable response",
        diagnostics: responseDiagnostics,
      };
    }
    return {
      ok: true,
      model,
      message: `Connected. ${model} is responding.`,
      diagnostics: responseDiagnostics,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "TIMEOUT", message: "Together AI connection timed out", diagnostics: diagnostics(null, apiKey) };
    }
    return { ok: false, error: "PROVIDER_ERROR", message: "Could not reach Together AI", diagnostics: diagnostics(null, apiKey) };
  } finally {
    clearTimeout(timeout);
  }
}
