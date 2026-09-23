export type ChatRole = "system" | "user" | "assistant";
export type AIMessage = { role: ChatRole; content: string };
export type TokenUsage = { input?: number; output?: number; total?: number };
export type AIRequest = { messages: AIMessage[]; signal?: AbortSignal };
export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model?: string;
  wireApi: "chat-completions" | "responses";
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
};
export type AIResult = { text: string; usage?: TokenUsage; model: string; finishReason?: string };
export type AIStreamEvent =
  | { type: "start"; model: string; upstreamId?: string }
  | { type: "text-delta"; text: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "complete"; finishReason?: string };
export type ConnectionReport = { ok: boolean; latencyMs: number; model?: string; models?: string[]; message: string };

export interface AIProvider {
  generate(request: AIRequest, config: ProviderConfig): Promise<AIResult>;
  stream(request: AIRequest, config: ProviderConfig): AsyncGenerator<AIStreamEvent>;
  testConnection(config: ProviderConfig): Promise<ConnectionReport>;
  listModels(config: ProviderConfig): Promise<string[]>;
}

export class AIProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly status = 502) {
    super(message);
    this.name = "AIProviderError";
  }
}
