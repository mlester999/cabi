import { z } from "zod";

import type { ActionCard } from "@/lib/actions/types";

/**
 * Runtime validation for action cards.
 *
 * Cards are persisted on the message row, so anything read back from the
 * database is treated as untrusted input. Validating on the way out means a
 * malformed, legacy, or tampered row degrades to "no card" instead of rendering
 * arbitrary data - and because every link is re-checked as an absolute HTTPS URL
 * here, a stored card can never introduce a `javascript:` or relative link.
 */

const rowSchema = z.object({
  label: z.string().max(60),
  value: z.string().max(200),
  mono: z.boolean().optional(),
  muted: z.boolean().optional(),
});

const httpsUrl = z.string().max(2_000).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Only absolute HTTPS links are allowed.");

const linkSchema = z.object({
  label: z.string().max(80),
  // Internal navigation is allowed, but only as a rooted app path.
  url: z.string().max(2_000),
  kind: z.enum(["CLANK_TRADE", "EXPLORER", "INTERNAL"]),
}).superRefine((value, context) => {
  if (value.kind === "INTERNAL") {
    if (!value.url.startsWith("/") || value.url.startsWith("//")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Internal links must be app-relative." });
    }
    return;
  }
  if (!httpsUrl.safeParse(value.url).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "External links must be absolute HTTPS URLs." });
  }
});

const baseSchema = {
  id: z.string().max(80),
  title: z.string().max(120),
  subtitle: z.string().max(200).optional(),
  rows: z.array(rowSchema).max(24),
  links: z.array(linkSchema).max(6),
  options: z.array(z.object({
    id: z.string().max(80),
    label: z.string().max(120),
    detail: z.string().max(200).optional(),
    address: z.string().max(120).optional(),
  })).max(8).optional(),
  requiresConfirmation: z.boolean().optional(),
  tone: z.enum(["neutral", "caution", "error"]).optional(),
  message: z.string().max(600).optional(),
  retry: z.object({
    label: z.string().max(40),
    prompt: z.string().min(1).max(600),
    parentGenerationId: z.string().uuid().optional(),
  }).optional(),
};

export const actionCardSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseSchema,
    kind: z.literal("TRADE"),
    action: z.enum(["BUY", "SELL"]),
    state: z.string().max(40),
    tokenAddress: z.string().max(120).optional(),
    tokenSymbol: z.string().max(24).optional(),
    tokenName: z.string().max(80).optional(),
    chainName: z.string().max(80).nullable().optional(),
    route: z.string().max(60).optional(),
    directExecution: z.boolean(),
  }),
  z.object({ ...baseSchema, kind: z.literal("TOKEN"), tokenAddress: z.string().max(120) }),
  z.object({ ...baseSchema, kind: z.literal("WALLET") }),
  z.object({ ...baseSchema, kind: z.literal("PORTFOLIO") }),
  z.object({ ...baseSchema, kind: z.literal("HOLDING"), tokenAddress: z.string().max(120) }),
  z.object({ ...baseSchema, kind: z.literal("CLARIFY") }),
  z.object({ ...baseSchema, kind: z.literal("NOTICE") }),
  /*
   * A stored image card is re-validated like any other. The URL must be an
   * absolute HTTPS storage link, so a tampered row cannot inject a
   * javascript: or data: URL into an <img src>, and membership in this union is
   * what keeps a hand-crafted row out of the transcript entirely.
   */
  z.object({
    ...baseSchema,
    kind: z.literal("IMAGE"),
    generationId: z.string().min(1).max(80),
    url: httpsUrl,
    prompt: z.string().max(400),
    aspectRatio: z.string().max(10),
    createdAt: z.string().max(40),
    canUseAsAvatar: z.boolean(),
    xp: z.number().int().min(0).max(100).nullable(),
  }),
]);

export function isActionCard(value: unknown): value is ActionCard {
  return actionCardSchema.safeParse(value).success;
}

export function parseActionCard(value: unknown): ActionCard | null {
  const parsed = actionCardSchema.safeParse(value);
  return parsed.success ? (parsed.data as ActionCard) : null;
}

/**
 * Owner-preview traces are response-only diagnostics. Never persist them in a
 * message row where a later normal conversation load could render them.
 */
export function stripActionCardDebugDetails(card: ActionCard): ActionCard {
  const safe = { ...card };
  delete safe.debugDetails;
  return safe;
}
