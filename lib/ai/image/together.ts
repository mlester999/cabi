import "server-only";

import { buildCabiImagePrompt } from "@/lib/cabi/image-identity";
import {
  IMAGE_PROVIDERS,
  imageModelFor,
  recommendedImageModel,
  type ImageModelDefinition,
} from "@/lib/image-generation/registry";
import {
  aspectRatioSizes,
  type AspectRatio,
  type ImageConnectionDiagnostics,
  type ImageConnectionTest,
  type ImageGenerationError,
  type ImageGenerationResult,
  type ImageProviderErrorCategory,
} from "@/lib/image-generation/types";
import type {
  ImagePipelineTrace,
  SafeTogetherProviderError,
  TogetherRequestComparison,
  TogetherRequestShape,
} from "@/lib/image-generation/pipeline-trace";

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

export const togetherImageEndpoint = IMAGE_PROVIDERS.together.endpoint;

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
  /** Negative guidance, sent only to models that advertise support. */
  negativePrompt?: string;
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
  /** Internal safe trace for the real chat/admin pipeline. */
  trace?: ImagePipelineTrace;
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

function modelDefinitionFor(model: string): ImageModelDefinition {
  return imageModelFor("together", model) ?? recommendedImageModel("together");
}

/** Default inference-step count for models that declare step support in the registry. */
const defaultSteps = 28;

function providerErrorText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 2_000).toLowerCase();
  if (!value || typeof value !== "object") return "";
  return Object.values(value as Record<string, unknown>).map(providerErrorText).join(" ").slice(0, 2_000);
}

function mentionsReferenceInput(value: unknown): boolean {
  const text = providerErrorText(value);
  return /(?:image_url|reference[_ ]?images?|reference image|input image|image format|unsupported image|invalid image)/iu.test(text);
}

function isUnsafePromptResponse(value: unknown): boolean {
  const text = providerErrorText(value);
  return /\b(?:unsafe[_ -]prompt|prompt.{0,60}(?:unsafe|blocked|rejected)|(?:safety|moderation|content[_ -]?policy).{0,60}(?:reject(?:ed)?|block(?:ed)?|fail(?:ed)?|violat(?:e|ed|ion))|(?:reject(?:ed)?|block(?:ed)?|fail(?:ed)?|violat(?:e|ed|ion)).{0,60}(?:safety|moderation|content[_ -]?policy|prompt))\b/iu.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeProviderText(value: unknown, sensitiveValues: readonly string[] = []): string | null {
  if (typeof value !== "string") return null;
  let safe = value;
  for (const secret of sensitiveValues) {
    if (secret.length >= 4) safe = safe.replaceAll(secret, "[redacted]");
  }
  safe = safe
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|together|supabase)[_-][A-Za-z0-9_-]{8,}\b/giu, "[redacted]")
    .replace(/(authorization|api[_ -]?key|secret|token)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[URL redacted]")
    .trim();
  return safe ? safe.slice(0, 600) : null;
}

function safeProviderToken(value: unknown, sensitiveValues: readonly string[] = []): string | null {
  return safeProviderText(value, sensitiveValues)?.replace(/[^A-Za-z0-9_.:-]/gu, "").slice(0, 96) || null;
}

/** Extracts only Together's documented error fields; raw bodies are never returned. */
export function sanitizeTogetherProviderError(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): SafeTogetherProviderError | null {
  const body = isRecord(value) ? value : null;
  const nested = body && isRecord(body.error) ? body.error : null;
  const source = nested ?? body;
  const messageValue = source?.message ?? (body && typeof body.error === "string" ? body.error : value);
  const details = {
    code: safeProviderToken(source?.code ?? body?.code, sensitiveValues),
    type: safeProviderToken(source?.type ?? body?.type, sensitiveValues),
    message: safeProviderText(messageValue, sensitiveValues),
    parameter: safeProviderToken(source?.param ?? source?.parameter ?? body?.param ?? body?.parameter, sensitiveValues),
  };
  return Object.values(details).some(Boolean) ? details : null;
}

function requestShape(body: Record<string, unknown>, aspectRatioInternal: string | null = null): TogetherRequestShape {
  const numberField = (key: string) => typeof body[key] === "number" && Number.isFinite(body[key]) ? body[key] as number : null;
  const textField = (key: string) => typeof body[key] === "string" ? body[key] as string : null;
  return {
    fields: Object.keys(body),
    model: textField("model"),
    promptLength: typeof body.prompt === "string" ? body.prompt.length : null,
    width: numberField("width"),
    height: numberField("height"),
    steps: numberField("steps"),
    n: numberField("n"),
    responseFormat: textField("response_format"),
    seedPresent: Object.hasOwn(body, "seed"),
    negativePromptPresent: Object.hasOwn(body, "negative_prompt"),
    qualityPresent: Object.hasOwn(body, "quality"),
    aspectRatioParameterPresent: Object.hasOwn(body, "aspect_ratio"),
    aspectRatioInternal,
    referenceInput: Object.hasOwn(body, "image_url") ? "image_url" : Object.hasOwn(body, "reference_images") ? "reference_images" : null,
  };
}

/** Minimal real connection probe used as the safe request-shape baseline. */
export function buildTogetherConnectionTestBody(model: string): Record<string, unknown> {
  return {
    model,
    prompt: "Cabi connection test",
    width: 512,
    height: 512,
    n: 1,
    response_format: "url",
  };
}

export function compareTogetherRequestBodies(
  workingBody: Record<string, unknown>,
  fullBody: Record<string, unknown>,
  fullAspectRatio: AspectRatio,
): TogetherRequestComparison {
  const working = requestShape(workingBody);
  const full = requestShape(fullBody, fullAspectRatio);
  return {
    working,
    full,
    onlyInFull: full.fields.filter((field) => !working.fields.includes(field)),
    onlyInWorking: working.fields.filter((field) => !full.fields.includes(field)),
  };
}

function classifyBadRequest(providerBody: unknown): Extract<ImageProviderErrorCategory,
  "invalid_request" | "invalid_parameter" | "unsupported_parameter" | "invalid_dimensions" | "model_error" | "provider_error"> {
  const details = sanitizeTogetherProviderError(providerBody);
  const code = details?.code?.toLowerCase() ?? "";
  const type = details?.type?.toLowerCase() ?? "";
  const parameter = details?.parameter?.toLowerCase() ?? "";
  const message = details?.message?.toLowerCase() ?? "";
  const all = `${code} ${type} ${parameter} ${message}`;

  if (/(?:model[_ -]?error|model.{0,30}(?:failed|failure|error))/iu.test(all)) return "model_error";
  if (/(?:unknown|unsupported|unrecognized|unexpected).{0,40}(?:parameter|field)|(?:parameter|field).{0,40}(?:unknown|unsupported|unrecognized|unexpected)/iu.test(all)) {
    return "unsupported_parameter";
  }
  if (/(?:width|height|dimension|resolution)/iu.test(`${parameter} ${message}`)
    && /(?:invalid|unsupported|out of range|must be|between)/iu.test(message)) return "invalid_dimensions";
  if (/(?:invalid[_ -]?request|malformed[_ -]?request|request.{0,30}(?:malformed|invalid))/iu.test(`${code} ${type} ${message}`)) return "invalid_request";
  if (parameter && /(?:invalid|incorrect|expected|required|must be|wrong)/iu.test(`${code} ${type} ${message}`)) return "invalid_parameter";
  if (/(?:invalid|incorrect|expected|required|must be|wrong).{0,50}(?:parameter|field|type)|(?:parameter|field|type).{0,50}(?:invalid|incorrect|expected|required|wrong)/iu.test(message)) {
    return "invalid_parameter";
  }
  return "provider_error";
}

async function postTogetherImageRequest(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: togetherAuthorizationHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

function classifyTogether403Reason(providerBody: unknown): Extract<ImageProviderErrorCategory,
  "third_party_data_sharing_required" | "model_access_restricted" | "organization_permission" | "invalid_project" | "other_provider_permission"> {
  const text = providerErrorText(providerBody);
  if (/(?:third[-_ ]party.{0,40}data.{0,30}sharing|data.{0,30}sharing.{0,40}third[-_ ]party)/iu.test(text)) {
    return "third_party_data_sharing_required";
  }
  if (/(?:model.{0,50}(?:access|permission|restricted|authori[sz]ation)|(?:access|permission).{0,50}model)/iu.test(text)) {
    return "model_access_restricted";
  }
  if (/(?:organi[sz]ation|workspace).{0,50}(?:permission|access|restricted|authori[sz]ation)|(?:permission|access).{0,50}(?:organi[sz]ation|workspace)/iu.test(text)) {
    return "organization_permission";
  }
  if (/(?:invalid|unknown|missing|not found).{0,30}project|project.{0,30}(?:invalid|unknown|missing|not found)/iu.test(text)) {
    return "invalid_project";
  }
  return "other_provider_permission";
}

export function classifyTogetherHttpError(status: number, input: { referenceAttached?: boolean; providerBody?: unknown } = {}): { error: ImageGenerationError; message: string; providerErrorCategory?: ImageProviderErrorCategory } {
  if ((status === 400 || status === 403 || status === 422) && input.referenceAttached && mentionsReferenceInput(input.providerBody)) {
    return { error: "PROVIDER_ERROR", message: "Reference image rejected", providerErrorCategory: "reference_input" };
  }
  if (status === 401) return { error: "NOT_CONFIGURED", message: "Authentication failed" };
  if (status === 402) return { error: "PROVIDER_ERROR", message: "Insufficient credits or billing issue" };
  if (status === 403) {
    return {
      error: "PROVIDER_ERROR",
      message: "Permission or account restriction",
      providerErrorCategory: classifyTogether403Reason(input.providerBody),
    };
  }
  if (status === 404) return { error: "PROVIDER_ERROR", message: "Model or endpoint unavailable" };
  if (status === 429) return { error: "RATE_LIMITED", message: "Rate limited" };
  if (status === 400 || status === 422) {
    if (isUnsafePromptResponse(input.providerBody)) {
      return {
        error: "UNSAFE_PROMPT",
        message: "I could not draw that one. Try describing it differently?",
        providerErrorCategory: "unsafe_prompt",
      };
    }
    return { error: "PROVIDER_ERROR", message: "Together rejected the image request", providerErrorCategory: classifyBadRequest(input.providerBody) };
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

async function readImage(payload: TogetherPayload, signal: AbortSignal, trace?: ImagePipelineTrace): Promise<Uint8Array | null> {
  const first = payload.data?.[0];
  if (!first) {
    trace?.record("PROVIDER_IMAGE_FETCHED", { error: "EMPTY_PROVIDER_OUTPUT" });
    return null;
  }

  if (typeof first.url === "string" && first.url.startsWith("https://")) {
    // Together's generated URLs are CDN objects. Some of those edges reject a
    // request with an empty User-Agent even though the generation succeeded.
    let response: Response;
    try {
      response = await fetch(first.url, {
        signal,
        headers: { "User-Agent": "cabi-cat-partner-unit/1.0", Accept: "image/*" },
      });
    } catch (error) {
      trace?.record("PROVIDER_IMAGE_FETCHED", {
        error: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "IMAGE_DOWNLOAD_FAILED",
      });
      throw error;
    }
    if (!response.ok) {
      trace?.record("PROVIDER_IMAGE_FETCHED", { httpStatus: response.status, error: "IMAGE_DOWNLOAD_FAILED" });
      return null;
    }
    const buffer = await response.arrayBuffer();
    const bytes = buffer.byteLength > 128 ? new Uint8Array(buffer) : null;
    trace?.record("PROVIDER_IMAGE_FETCHED", {
      httpStatus: response.status,
      contentType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null,
      byteLength: buffer.byteLength,
      error: bytes ? null : "IMAGE_DOWNLOAD_FAILED",
    });
    return bytes;
  }

  if (typeof first.b64_json === "string" && first.b64_json.length > 64) {
    try {
      const binary = atob(first.b64_json);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const image = bytes.byteLength > 128 ? bytes : null;
      trace?.record("PROVIDER_IMAGE_FETCHED", { byteLength: bytes.byteLength, error: image ? null : "IMAGE_DOWNLOAD_FAILED" });
      return image;
    } catch {
      trace?.record("PROVIDER_IMAGE_FETCHED", { error: "IMAGE_DOWNLOAD_FAILED" });
      return null;
    }
  }

  trace?.record("PROVIDER_IMAGE_FETCHED", { error: "INVALID_RESPONSE" });
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
  return imageModelFor("together", model ?? "")?.id ?? recommendedImageModel("together").id;
}

function sizeForModel(model: ImageModelDefinition, ratio: AspectRatio): { width: number; height: number; aspectRatio: AspectRatio } {
  const aspectRatio = model.supportedSizes.includes(ratio)
    ? ratio
    : model.supportedSizes[0] ?? "1:1";
  return { ...sizeForAspectRatio(aspectRatio), aspectRatio };
}

function isUsableReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Builds the Together wire body from the selected registry entry.
 *
 * Keeping this separate makes it possible to test that unsupported fields are
 * omitted without making a provider call. The registry is the only place that
 * decides which optional Together parameters are legal for a model.
 */
export function buildTogetherRequestBody(
  request: TogetherRequest,
  model: string,
): { body: Record<string, unknown>; width: number; height: number; aspectRatio: AspectRatio } {
  const definition = modelDefinitionFor(model);
  const size = sizeForModel(definition, request.aspectRatio);
  const body: Record<string, unknown> = {
    model: definition.id,
    prompt: request.preparedPrompt ?? buildCabiImagePrompt(request.prompt),
    n: 1,
    response_format: "url",
  };

  if (definition.supportedSizes.length > 0) {
    body.width = size.width;
    body.height = size.height;
  }
  if (definition.supportsSteps) body.steps = defaultSteps;
  if (definition.supportsSeed && typeof request.seed === "number") body.seed = request.seed;
  if (definition.supportsNegativePrompt && request.negativePrompt?.trim()) {
    body.negative_prompt = request.negativePrompt.trim();
  }

  const reference = request.referenceImages?.find(isUsableReferenceUrl);
  if (definition.supportsReferenceImages && definition.referenceParameter && reference) {
    if (definition.referenceParameter === "reference_images") {
      body.reference_images = [reference];
    } else {
      body.image_url = reference;
    }
  }

  return { body, width: size.width, height: size.height, aspectRatio: size.aspectRatio };
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
  const selectedModel = modelDefinitionFor(model);
  const { body, width, height } = buildTogetherRequestBody(request, selectedModel.id);
  const isAdminDiagnostic = request.trace?.snapshot().source === "ADMIN_TEST";
  const requestComparison = isAdminDiagnostic
    ? compareTogetherRequestBodies(buildTogetherConnectionTestBody(selectedModel.id), body, request.aspectRatio)
    : null;
  request.trace?.update({
    provider: "together",
    model,
    aspectRatio: request.aspectRatio,
    width,
    height,
    referenceAttached: Boolean(request.referenceImages?.length),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs ?? 120_000);

  try {
    request.trace?.record("TOGETHER_REQUEST_STARTED", {
      provider: "together",
      model,
      aspectRatio: request.aspectRatio,
      width,
      height,
      referenceAttached: Boolean(request.referenceImages?.length),
      ...(requestComparison ? { requestComparison } : {}),
    });
    const response = await postTogetherImageRequest(config?.endpoint ?? togetherImageEndpoint, apiKey, body, controller.signal);

    if (!response.ok) {
      const providerBodyText = (await response.text().catch(() => "")).slice(0, 8_192);
      let providerBody: unknown = providerBodyText;
      try { providerBody = providerBodyText ? JSON.parse(providerBodyText) : null; } catch { /* plain text is still classified by its safe keywords */ }
      const providerError = sanitizeTogetherProviderError(providerBody, [apiKey, String(body.prompt)]);
      const classified = classifyTogetherHttpError(response.status, {
        referenceAttached: Boolean(request.referenceImages?.length),
        providerBody,
      });
      request.trace?.record("TOGETHER_RESPONSE_RECEIVED", {
        httpStatus: response.status,
        error: classified.error,
        providerErrorCategory: classified.providerErrorCategory ?? null,
        ...(isAdminDiagnostic ? { providerError, requestComparison } : {}),
      });
      return { ok: false, ...classified, httpStatus: response.status };
    }

    request.trace?.record("TOGETHER_RESPONSE_RECEIVED", { httpStatus: response.status });

    const payload = await response.json().catch(() => null) as TogetherPayload | null;
    if (!payload) return { ok: false, error: "INVALID_RESPONSE", message: "The image service sent back something I could not read." };

    const bytes = await readImage(payload, controller.signal, request.trace);
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
      request.trace?.record("TOGETHER_RESPONSE_RECEIVED", { error: "TIMEOUT" });
      return { ok: false, error: "TIMEOUT", message: "That took too long. Try again?" };
    }
    request.trace?.record("TOGETHER_RESPONSE_RECEIVED", { error: "PROVIDER_ERROR" });
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
  const requestedModel = config?.model?.trim() || resolveTogetherModel();
  const selectedModel = imageModelFor("together", requestedModel);
  const model = selectedModel?.id ?? recommendedImageModel("together").id;
  const body = buildTogetherConnectionTestBody(model);
  const minimalRequestShape = requestShape(body);
  let providerRequestStarted = false;
  const diagnostics = (
    httpStatus: number | null,
    loadedKey: string | null,
    providerError: SafeTogetherProviderError | null = null,
  ): ImageConnectionDiagnostics => ({
    provider: "Together AI",
    providerReceived: "together",
    providerValid: true,
    modelReceived: requestedModel,
    modelValid: selectedModel !== null,
    providerRequestStarted,
    endpoint,
    keyLoaded: Boolean(loadedKey),
    keySuffix: loadedKey ? loadedKey.slice(-4) : null,
    httpStatus,
    requestShape: minimalRequestShape,
    providerError,
  });

  if (!apiKey) {
    return {
      ok: false,
      error: "NOT_CONFIGURED",
      message: "Together AI key is not configured",
      diagnostics: diagnostics(null, null),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs ?? 30_000);
  try {
    // This is deliberately a minimal real generation request. It proves the
    // exact Together key can authenticate and generate without involving the
    // Cabi reference pipeline or any OpenAI-compatible route.
    providerRequestStarted = true;
    const response = await postTogetherImageRequest(endpoint, apiKey, body, controller.signal);
    const responseDiagnostics = diagnostics(response.status, apiKey);
    if (!response.ok) {
      const providerBodyText = (await response.text().catch(() => "")).slice(0, 8_192);
      let providerBody: unknown = providerBodyText;
      try { providerBody = providerBodyText ? JSON.parse(providerBodyText) : null; } catch { /* plain text is still classified by its safe keywords */ }
      const providerError = sanitizeTogetherProviderError(providerBody, [apiKey, String(body.prompt)]);
      return {
        ok: false,
        ...classifyTogetherHttpError(response.status, { providerBody }),
        diagnostics: diagnostics(response.status, apiKey, providerError),
      };
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
