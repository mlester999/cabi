/**
 * Safe, serialisable trace data for one Cabi image request.
 *
 * This module intentionally has no server-only import so its serialisable types
 * can be shared by server utilities and tests. Snapshots stay in server logs and
 * admin diagnostics; they are not included in chat cards or user responses.
 */

export const imagePipelineStages = [
  "IMAGE_INTENT_DETECTED",
  "USER_AUTHORIZED",
  "QUOTA_CHECK_PASSED",
  "IMAGE_CONFIG_RESOLVED",
  "CABI_REFERENCE_RESOLVED",
  "PROMPT_BUILT",
  "TOGETHER_REQUEST_STARTED",
  "TOGETHER_RESPONSE_RECEIVED",
  "PROVIDER_IMAGE_FETCHED",
  "SUPABASE_UPLOAD_STARTED",
  "SUPABASE_UPLOAD_COMPLETED",
  "GENERATION_ROW_CREATED",
  "GENERATION_ROW_UPDATED",
  "CHAT_IMAGE_MESSAGE_CREATED",
  "CHAT_MESSAGE_CREATED",
  "CHAT_MESSAGE_PERSISTED",
  "FINAL_RESPONSE_RETURNED",
] as const;

export type ImagePipelineStage = (typeof imagePipelineStages)[number];
export type ImagePipelineSource = "ADMIN_TEST" | "CHAT_GENERATION" | "HTTP_GENERATION";

export type ImagePipelineDebugEvent = {
  stage: ImagePipelineStage;
  latencyMs: number;
  httpStatus: number | null;
  contentType: string | null;
  byteLength: number | null;
  error: string | null;
};

/** Provider error fields allowlisted for owner-only diagnostics. */
export type SafeTogetherProviderError = {
  code: string | null;
  type: string | null;
  message: string | null;
  parameter: string | null;
};

/** Request metadata with field names and non-sensitive values only. */
export type TogetherRequestShape = {
  fields: string[];
  model: string | null;
  promptLength: number | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  n: number | null;
  responseFormat: string | null;
  seedPresent: boolean;
  negativePromptPresent: boolean;
  qualityPresent: boolean;
  aspectRatioParameterPresent: boolean;
  aspectRatioInternal: string | null;
  referenceInput: "image_url" | "reference_images" | null;
};

export type TogetherRequestComparison = {
  working: TogetherRequestShape;
  full: TogetherRequestShape;
  onlyInFull: string[];
  onlyInWorking: string[];
};

export type ImagePipelineDebugDetails = {
  requestId: string;
  source: ImagePipelineSource;
  wallet: string | null;
  conversation: string | null;
  provider: string | null;
  model: string | null;
  referenceVersion: number | null;
  referenceAttached: boolean;
  referenceActive: boolean;
  modelReferenceSupport: boolean;
  identityLockApplied: boolean;
  normalizedPromptApplied: boolean;
  compositionType: string | null;
  aspectRatio: string | null;
  width: number | null;
  height: number | null;
  /** The first stage that recorded a safe error, when one exists. */
  stage: ImagePipelineStage | null;
  /** The most recent stage reached, useful when a later persistence step fails. */
  lastStage: ImagePipelineStage | null;
  httpStatus: number | null;
  contentType: string | null;
  byteLength: number | null;
  error: string | null;
  providerErrorCategory: string | null;
  /** Present only for the admin full-generation probe. */
  providerError: SafeTogetherProviderError | null;
  /** Present only for the admin full-generation probe. */
  requestComparison: TogetherRequestComparison | null;
  promptHash: string | null;
  promptLength: number | null;
  scene: string | null;
  expression: string | null;
  outfit: string | null;
  retryCount: number;
  latencyMs: number;
  events: ImagePipelineDebugEvent[];
};

type TraceFields = {
  walletAccountId?: string | null;
  conversationId?: string | null;
  provider?: string | null;
  model?: string | null;
  referenceVersion?: number | null;
  referenceAttached?: boolean;
  referenceActive?: boolean;
  modelReferenceSupport?: boolean;
  identityLockApplied?: boolean;
  normalizedPromptApplied?: boolean;
  compositionType?: string | null;
  aspectRatio?: string | null;
  width?: number | null;
  height?: number | null;
  httpStatus?: number | null;
  contentType?: string | null;
  byteLength?: number | null;
  error?: string | null;
  providerErrorCategory?: string | null;
  providerError?: SafeTogetherProviderError | null;
  requestComparison?: TogetherRequestComparison | null;
  promptHash?: string | null;
  promptLength?: number | null;
  scene?: string | null;
  expression?: string | null;
  outfit?: string | null;
  retryCount?: number;
};

function safeId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function requestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `cabi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Mutable server-side collector that only exposes its safe snapshot. */
export class ImagePipelineTrace {
  readonly requestId = requestId();
  private readonly startedAt = Date.now();
  private readonly events: ImagePipelineDebugEvent[] = [];
  private readonly context: {
    source: ImagePipelineSource;
    wallet: string | null;
    conversation: string | null;
    provider: string | null;
    model: string | null;
    referenceVersion: number | null;
    referenceAttached: boolean;
    referenceActive: boolean;
    modelReferenceSupport: boolean;
    identityLockApplied: boolean;
    normalizedPromptApplied: boolean;
    compositionType: string | null;
    aspectRatio: string | null;
    width: number | null;
    height: number | null;
    providerErrorCategory: string | null;
    providerError: SafeTogetherProviderError | null;
    requestComparison: TogetherRequestComparison | null;
    promptHash: string | null;
    promptLength: number | null;
    scene: string | null;
    expression: string | null;
    outfit: string | null;
    retryCount: number;
  };
  private failed: { stage: ImagePipelineStage; httpStatus: number | null; error: string } | null = null;
  private lastStage: ImagePipelineStage | null = null;

  constructor(input: {
    source: ImagePipelineSource;
    walletAccountId?: string | null;
    conversationId?: string | null;
    aspectRatio?: string | null;
  }) {
    this.context = {
      source: input.source,
      wallet: safeId(input.walletAccountId),
      conversation: safeId(input.conversationId),
      provider: null,
      model: null,
      referenceVersion: null,
      referenceAttached: false,
      referenceActive: false,
      modelReferenceSupport: false,
      identityLockApplied: false,
      normalizedPromptApplied: false,
      compositionType: null,
      aspectRatio: input.aspectRatio ?? null,
      width: null,
      height: null,
      providerErrorCategory: null,
      providerError: null,
      requestComparison: null,
      promptHash: null,
      promptLength: null,
      scene: null,
      expression: null,
      outfit: null,
      retryCount: 0,
    };
  }

  update(fields: TraceFields) {
    if (fields.walletAccountId !== undefined) this.context.wallet = safeId(fields.walletAccountId);
    if (fields.conversationId !== undefined) this.context.conversation = safeId(fields.conversationId);
    if (fields.provider !== undefined) this.context.provider = fields.provider;
    if (fields.model !== undefined) this.context.model = fields.model;
    if (fields.referenceVersion !== undefined) this.context.referenceVersion = fields.referenceVersion;
    if (fields.referenceAttached !== undefined) this.context.referenceAttached = fields.referenceAttached;
    if (fields.referenceActive !== undefined) this.context.referenceActive = fields.referenceActive;
    if (fields.modelReferenceSupport !== undefined) this.context.modelReferenceSupport = fields.modelReferenceSupport;
    if (fields.identityLockApplied !== undefined) this.context.identityLockApplied = fields.identityLockApplied;
    if (fields.normalizedPromptApplied !== undefined) this.context.normalizedPromptApplied = fields.normalizedPromptApplied;
    if (fields.compositionType !== undefined) this.context.compositionType = fields.compositionType;
    if (fields.aspectRatio !== undefined) this.context.aspectRatio = fields.aspectRatio;
    if (fields.width !== undefined) this.context.width = fields.width;
    if (fields.height !== undefined) this.context.height = fields.height;
    if (fields.providerErrorCategory !== undefined) this.context.providerErrorCategory = fields.providerErrorCategory;
    if (this.context.source === "ADMIN_TEST" && fields.providerError !== undefined) {
      this.context.providerError = fields.providerError ? { ...fields.providerError } : null;
    }
    if (this.context.source === "ADMIN_TEST" && fields.requestComparison !== undefined) {
      this.context.requestComparison = fields.requestComparison
        ? {
            working: { ...fields.requestComparison.working, fields: [...fields.requestComparison.working.fields] },
            full: { ...fields.requestComparison.full, fields: [...fields.requestComparison.full.fields] },
            onlyInFull: [...fields.requestComparison.onlyInFull],
            onlyInWorking: [...fields.requestComparison.onlyInWorking],
          }
        : null;
    }
    if (fields.promptHash !== undefined) this.context.promptHash = fields.promptHash;
    if (fields.promptLength !== undefined) this.context.promptLength = fields.promptLength;
    if (fields.scene !== undefined) this.context.scene = fields.scene?.slice(0, 400) ?? null;
    if (fields.expression !== undefined) this.context.expression = fields.expression?.slice(0, 40) ?? null;
    if (fields.outfit !== undefined) this.context.outfit = fields.outfit?.slice(0, 80) ?? null;
    if (fields.retryCount !== undefined) this.context.retryCount = Math.max(0, Math.min(2, Math.trunc(fields.retryCount)));
  }

  record(stage: ImagePipelineStage, fields: TraceFields = {}) {
    this.update(fields);
    const httpStatus = fields.httpStatus ?? null;
    const contentType = fields.contentType ?? null;
    const byteLength = fields.byteLength ?? null;
    const error = fields.error ?? null;
    const latencyMs = Math.max(0, Date.now() - this.startedAt);
    this.lastStage = stage;
    this.events.push({ stage, latencyMs, httpStatus, contentType, byteLength, error });
    if (this.events.length > 32) this.events.shift();
    if (error && !this.failed) this.failed = { stage, httpStatus, error };
  }

  snapshot(): ImagePipelineDebugDetails {
    const latestContentType = [...this.events].reverse().find((event) => event.contentType !== null)?.contentType ?? null;
    const latestByteLength = [...this.events].reverse().find((event) => event.byteLength !== null)?.byteLength ?? null;
    return {
      requestId: this.requestId,
      ...this.context,
      stage: this.failed?.stage ?? null,
      lastStage: this.lastStage,
      httpStatus: this.failed?.httpStatus ?? null,
      contentType: latestContentType,
      byteLength: latestByteLength,
      error: this.failed?.error ?? null,
      providerError: this.context.providerError ? { ...this.context.providerError } : null,
      requestComparison: this.context.requestComparison
        ? {
            working: { ...this.context.requestComparison.working, fields: [...this.context.requestComparison.working.fields] },
            full: { ...this.context.requestComparison.full, fields: [...this.context.requestComparison.full.fields] },
            onlyInFull: [...this.context.requestComparison.onlyInFull],
            onlyInWorking: [...this.context.requestComparison.onlyInWorking],
          }
        : null,
      latencyMs: Math.max(0, Date.now() - this.startedAt),
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

export function createImagePipelineTrace(input: ConstructorParameters<typeof ImagePipelineTrace>[0]) {
  return new ImagePipelineTrace(input);
}
