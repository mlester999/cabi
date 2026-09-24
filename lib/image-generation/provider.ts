import "server-only";

import { generateTogetherImage } from "@/lib/ai/image/together";
import { buildCabiImagePrompt, cabiNegativePrompt, cabiReferenceAsset } from "@/lib/image-generation/cabi-character";
import {
  aspectRatioSizes,
  type AspectRatio,
  type GeneratedImage,
  type ImageConnectionTest,
  type ImageGenerationError,
  type ImageGenerationResult,
  type ImageProviderConfig,
  type ImageQuality,
} from "@/lib/image-generation/types";

/**
 * Image generation providers.
 *
 * Deliberately independent of the DeepSeek chat provider: a chat outage must not
 * disable image generation and vice versa. The API key is passed in by the
 * caller, which reads it from encrypted storage - this module never touches the
 * database and never logs the key.
 *
 * Every provider receives the same canonical Cabi description, so switching
 * providers cannot change who Cabi is.
 */

const timeoutMs = 90_000;

function timedSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  parent?.addEventListener("abort", () => controller.abort(), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function sizeFor(ratio: AspectRatio) {
  return aspectRatioSizes[ratio] ?? aspectRatioSizes["1:1"];
}

/**
 * The request every provider receives.
 *
 * `seed` and `referenceImages` are part of the contract even though the current
 * Together text-to-image path ignores them: a new provider must be addable
 * without changing the call sites, and the reference workflow needs a defined
 * place to arrive. A provider that cannot honour an option ignores it rather
 * than inventing an API parameter it does not support.
 */
export type ImageGenerationRequest = {
  scene: string;
  aspectRatio: AspectRatio;
  quality?: ImageQuality;
  /** Reproducible results when the provider supports seeding. */
  seed?: number;
  /**
   * Canonical reference images for character consistency. Server-controlled:
   * never populated from client input.
   */
  referenceImages?: string[];
  signal?: AbortSignal;
};

export interface ImageGenerationProvider {
  readonly id: ImageProviderConfig["provider"];
  readonly label: string;
  readonly supportsReferenceImage: boolean;
  generateCabiImage(input: ImageGenerationRequest): Promise<ImageGenerationResult>;
  testConnection(): Promise<ImageConnectionTest>;
}

function fail(error: ImageGenerationError, message: string): ImageGenerationResult {
  return { ok: false, error, message };
}

/** Reads a base64 payload defensively; a malformed response is not a crash. */
function decodeBase64Image(value: unknown): { bytes: Uint8Array; contentType: GeneratedImage["contentType"] } | null {
  if (typeof value !== "string" || value.length < 64) return null;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength < 128) return null;
    // Sniff the magic bytes rather than trusting a declared content type.
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, contentType: "image/png" };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, contentType: "image/jpeg" };
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return { bytes, contentType: "image/webp" };
    return null;
  } catch {
    return null;
  }
}

/** OpenAI-compatible images API (`/images/generations`). */
function createOpenAiCompatibleProvider(config: ImageProviderConfig): ImageGenerationProvider {
  const base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/u, "");
  const model = config.model || "gpt-image-1";

  return {
    id: config.provider,
    label: "OpenAI-compatible",
    supportsReferenceImage: true,
    async generateCabiImage({ scene, aspectRatio, quality, signal }) {
      const { signal: scoped, clear } = timedSignal(signal);
      try {
        const response = await fetch(`${base}/images/generations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model,
            prompt: buildCabiImagePrompt(scene),
            n: 1,
            size: `${sizeFor(aspectRatio).width}x${sizeFor(aspectRatio).height}`,
            quality: quality === "high" ? "high" : "medium",
          }),
          signal: scoped,
        });
        if (response.status === 429) return fail("RATE_LIMITED", "The image provider is busy right now. Try again in a moment.");
        if (!response.ok) return fail("PROVIDER_ERROR", "I could not draw that one just now.");
        const payload = await response.json() as { data?: Array<{ b64_json?: unknown }> };
        const decoded = decodeBase64Image(payload.data?.[0]?.b64_json);
        if (!decoded) return fail("INVALID_RESPONSE", "The image provider sent back something I could not read.");
        const size = sizeFor(aspectRatio);
        return {
          ok: true,
          image: { bytes: decoded.bytes, contentType: decoded.contentType, provider: config.provider, model, width: size.width, height: size.height },
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return fail("TIMEOUT", "That took too long. Try again?");
        return fail("PROVIDER_ERROR", "I could not reach the image provider.");
      } finally {
        clear();
      }
    },
    async testConnection() {
      const { signal, clear } = timedSignal();
      try {
        const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal });
        if (response.status === 401 || response.status === 403) return { ok: false, error: "PROVIDER_ERROR", message: "That API key was rejected." };
        if (!response.ok) return { ok: false, error: "PROVIDER_ERROR", message: `The provider replied with ${response.status}.` };
        return { ok: true, model, message: "Connected." };
      } catch {
        return { ok: false, error: "PROVIDER_ERROR", message: "Could not reach the provider." };
      } finally {
        clear();
      }
    },
  };
}

/** Stability AI: JSON in, base64 image out. */
function createStabilityProvider(config: ImageProviderConfig): ImageGenerationProvider {
  const base = (config.baseUrl || "https://api.stability.ai").replace(/\/$/u, "");
  const model = config.model || "sd3.5-large";
  const size = (ratio: AspectRatio) => aspectRatioSizes[ratio] ?? aspectRatioSizes["1:1"];

  return {
    id: "stability",
    label: "Stability AI",
    supportsReferenceImage: true,
    async generateCabiImage({ scene, aspectRatio, signal }) {
      const { signal: scoped, clear } = timedSignal(signal);
      try {
        const form = new FormData();
        form.append("prompt", buildCabiImagePrompt(scene));
        form.append("negative_prompt", cabiNegativePrompt);
        form.append("output_format", "png");
        form.append("aspect_ratio", aspectRatio);
        const response = await fetch(`${base}/v2beta/stable-image/generate/${model.startsWith("sd3") ? "sd3" : "core"}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
          body: form,
          signal: scoped,
        });
        if (response.status === 429) return fail("RATE_LIMITED", "The image provider is busy right now. Try again in a moment.");
        if (!response.ok) return fail("PROVIDER_ERROR", "I could not draw that one just now.");
        const payload = await response.json() as { image?: unknown };
        const decoded = decodeBase64Image(payload.image);
        if (!decoded) return fail("INVALID_RESPONSE", "The image provider sent back something I could not read.");
        const dimensions = size(aspectRatio);
        return {
          ok: true,
          image: { bytes: decoded.bytes, contentType: decoded.contentType, provider: "stability", model, width: dimensions.width, height: dimensions.height },
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return fail("TIMEOUT", "That took too long. Try again?");
        return fail("PROVIDER_ERROR", "I could not reach the image provider.");
      } finally {
        clear();
      }
    },
    async testConnection() {
      const { signal, clear } = timedSignal();
      try {
        const response = await fetch(`${base}/v1/user/account`, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal });
        if (response.status === 401 || response.status === 403) return { ok: false, error: "PROVIDER_ERROR", message: "That API key was rejected." };
        if (!response.ok) return { ok: false, error: "PROVIDER_ERROR", message: `The provider replied with ${response.status}.` };
        return { ok: true, model, message: "Connected." };
      } catch {
        return { ok: false, error: "PROVIDER_ERROR", message: "Could not reach the provider." };
      } finally {
        clear();
      }
    },
  };
}

/**
 * Generic HTTP provider for a self-hosted or custom endpoint that speaks the
 * OpenAI images shape. This is what makes the layer future-proof without
 * inventing an integration for a service nobody has verified.
 */
function createCustomProvider(config: ImageProviderConfig): ImageGenerationProvider {
  return { ...createOpenAiCompatibleProvider(config), id: "custom", label: "Custom endpoint" };
}

/**
 * Together AI adapter.
 *
 * Delegates to the dedicated service so there is exactly one implementation of
 * the Together call — the chat path and the endpoint both reach the same code.
 */
function createTogetherProvider(config: ImageProviderConfig): ImageGenerationProvider {
  const model = config.model || undefined;
  return {
    id: "together",
    label: "Together AI",
    // Depends on the selected model, not the provider.
    supportsReferenceImage: false,
    async generateCabiImage({ scene, aspectRatio, seed, referenceImages }) {
      // seed and referenceImages are forwarded, but the Together service only
      // sends them when the selected model genuinely supports them.
      const result = await generateTogetherImage(
        { prompt: scene, aspectRatio, seed, referenceImages },
        { apiKey: config.apiKey, model },
      );
      if (result.ok) return result;
      return { ok: false, error: result.error, message: result.message };
    },
    async testConnection() {
      const { testTogetherConnection } = await import("@/lib/ai/image/together");
      return testTogetherConnection({ apiKey: config.apiKey, model });
    },
  };
}

export function createImageProvider(config: ImageProviderConfig): ImageGenerationProvider {
  if (!config.apiKey) {
    // A provider with no key reports NOT_CONFIGURED for every call rather than
    // throwing, so callers can render an honest state.
    const unconfigured: ImageGenerationProvider = {
      id: config.provider,
      label: "Not configured",
      supportsReferenceImage: false,
      async generateCabiImage() { return fail("NOT_CONFIGURED", "Image generation has not been configured yet."); },
      async testConnection() { return { ok: false, error: "NOT_CONFIGURED", message: "Add an API key first." }; },
    };
    return unconfigured;
  }
  switch (config.provider) {
    case "together": return createTogetherProvider(config);
    case "stability": return createStabilityProvider(config);
    case "custom": return createCustomProvider(config);
    case "replicate": return createOpenAiCompatibleProvider({ ...config, baseUrl: config.baseUrl || "https://api.replicate.com/v1" });
    case "openai":
    default: return createOpenAiCompatibleProvider(config);
  }
}

export { cabiReferenceAsset };