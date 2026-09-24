/**
 * Safe, serialisable trace data for one Cabi image request.
 *
 * This module intentionally has no server-only import because the owner-preview
 * error card may carry the already-sanitised snapshot to the browser. Prompts,
 * signed URLs, response bodies, and credentials never belong in this type.
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

export type ImagePipelineDebugDetails = {
  requestId: string;
  source: ImagePipelineSource;
  wallet: string | null;
  conversation: string | null;
  provider: string | null;
  model: string | null;
  referenceVersion: number | null;
  referenceAttached: boolean;
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
  aspectRatio?: string | null;
  width?: number | null;
  height?: number | null;
  httpStatus?: number | null;
  contentType?: string | null;
  byteLength?: number | null;
  error?: string | null;
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
    aspectRatio: string | null;
    width: number | null;
    height: number | null;
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
      aspectRatio: input.aspectRatio ?? null,
      width: null,
      height: null,
    };
  }

  update(fields: TraceFields) {
    if (fields.walletAccountId !== undefined) this.context.wallet = safeId(fields.walletAccountId);
    if (fields.conversationId !== undefined) this.context.conversation = safeId(fields.conversationId);
    if (fields.provider !== undefined) this.context.provider = fields.provider;
    if (fields.model !== undefined) this.context.model = fields.model;
    if (fields.referenceVersion !== undefined) this.context.referenceVersion = fields.referenceVersion;
    if (fields.referenceAttached !== undefined) this.context.referenceAttached = fields.referenceAttached;
    if (fields.aspectRatio !== undefined) this.context.aspectRatio = fields.aspectRatio;
    if (fields.width !== undefined) this.context.width = fields.width;
    if (fields.height !== undefined) this.context.height = fields.height;
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
      latencyMs: Math.max(0, Date.now() - this.startedAt),
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

export function createImagePipelineTrace(input: ConstructorParameters<typeof ImagePipelineTrace>[0]) {
  return new ImagePipelineTrace(input);
}
