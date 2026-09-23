import { z } from "zod";

const guestHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(50_000),
});

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(12_000),
  clientRequestId: z.string().uuid().optional(),
  retryOfMessageId: z.string().uuid().optional(),
  timezone: z.string().max(80).optional(),
  chainId: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  onboardingName: z.boolean().optional(),
  // Browser-memory context for guest/temporary chats. The server never stores it.
  guestHistory: z.array(guestHistoryMessageSchema).max(24).optional(),
  // Authenticated clients use false after choosing "Keep Temporary".
  persist: z.boolean().optional(),
});

export const conversationPatchSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);
export const guestChatImportSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  messages: z.array(guestHistoryMessageSchema.extend({
    metadata: z.record(z.string(), z.unknown()).refine(
      (value) => JSON.stringify(value).length <= 20_000,
      "Message metadata is too large.",
    ).optional(),
  })).min(1).max(100),
});
export const memorySettingsSchema = z.object({ enabled: z.boolean() });
export const reactionSchema = z.object({ reaction: z.enum(["heart", "laugh", "helpful", "none"]) });

export const aiSettingsSchema = z.object({
  apiKey: z.string().min(8).max(500).optional(),
  removeApiKey: z.boolean().optional(),
  baseUrl: z.string().url().refine((value) => value.startsWith("https://"), "HTTPS is required"),
  model: z.string().trim().max(120).optional().or(z.literal("")),
  wireApi: z.enum(["chat-completions", "responses"]),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(32_000),
  timeoutMs: z.number().int().min(5_000).max(180_000),
  retryCount: z.number().int().min(0).max(3),
  streaming: z.boolean(),
});

export const adminLoginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(256) });
