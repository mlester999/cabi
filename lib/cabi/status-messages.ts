/**
 * CABI ACTIVITY MESSAGES
 *
 * Cabi should never look like a generic spinner. One catalogue holds every line
 * she says while she is working, grouped by what she is actually doing, so the
 * wording lives in one place instead of being scattered through components.
 *
 * Isomorphic on purpose: the browser renders these, so the text is shipped
 * client-side. Nothing here is secret — it is product copy.
 *
 * Two rules the rest of the app relies on:
 *
 * - A category never runs out. Every bank has built-in defaults, and an owner
 *   adding custom lines ADDS to them rather than replacing them, so no
 *   configuration can leave the UI with nothing to say.
 * - The long-wait helpers remain separate from the visible activity copy, so
 *   "this is taking a while" is a statement about elapsed time and never a
 *   fabricated percentage.
 */

export const cabiStatusTypes = [
  "CHAT_THINKING",
  "IMAGE_GENERATING",
  "MEMORY_LOADING",
  "WALLET_VERIFYING",
  "PROFILE_SAVING",
  "IMAGE_SAVING",
] as const;

export type CabiStatusType = (typeof cabiStatusTypes)[number];

export const cabiStatusDefaults: Record<CabiStatusType, readonly string[]> = {
  CHAT_THINKING: [
    "Cabi is thinking…",
  ],
  IMAGE_GENERATING: [
    "Cabi is generating your image…",
  ],
  MEMORY_LOADING: [
    "Let me remember...",
    "Checking what I remember...",
    "Wait, I know this...",
    "Looking through our memories...",
    "I think I remember...",
  ],
  WALLET_VERIFYING: [
    "Checking your wallet...",
    "Making sure it's really you...",
    "Verifying your signature...",
    "Connecting your Cabi profile...",
  ],
  PROFILE_SAVING: [
    "Saving that...",
    "Got it.",
    "Okay, I'll remember you as that.",
  ],
  IMAGE_SAVING: [
    "Saving your Cabi image...",
    "Keeping this one for you...",
  ],
};

/**
 * The single stable sentence a screen reader hears.
 *
 * Visible activity text is decoration; announcing a new line every three seconds
 * is hostile. Assistive technology gets one calm statement per activity, in an
 * `aria-live` region that only changes when the *activity* changes.
 */
export const cabiStatusAnnouncements: Record<CabiStatusType, string> = {
  CHAT_THINKING: "Cabi is processing your request.",
  IMAGE_GENERATING: "Cabi is generating an image.",
  MEMORY_LOADING: "Cabi is checking her memories.",
  WALLET_VERIFYING: "Cabi is verifying your wallet.",
  PROFILE_SAVING: "Cabi is saving your profile.",
  IMAGE_SAVING: "Cabi is saving your image.",
};

/**
 * Escalation lines for a generation that is genuinely taking a while.
 *
 * These describe elapsed time, never a made-up completion figure. There is no
 * percentage anywhere in this file, because the provider does not report one.
 */
export const cabiLongWait = {
  /** 15s+: still fine, still working. */
  patient: "Still working on it...",
  /** 30s+: longer than usual, and said so plainly. */
  extended: "This one's taking a little longer.",
} as const;

/* ---------------------------------------------------------------------------
 * Failure lines. Plain, warm, and never a stack trace.
 * ------------------------------------------------------------------------- */

export const cabiFailureMessages = {
  CHAT: "My brain tripped for a second.",
  IMAGE: "That one didn't come out. Want me to try again?",
  WALLET: "I couldn't verify that wallet.",
  MEMORY: "I couldn't pull that memory right now.",
} as const;

export type CabiFailureKind = keyof typeof cabiFailureMessages;

/** The label on the retry button that accompanies a failure line. */
export const cabiRetryLabel = "Try Again";

/** Optional owner-supplied extra lines, per category. */
export type CabiStatusOverrides = Partial<Record<CabiStatusType, readonly string[]>>;

/**
 * The activity catalogue: built-in defaults, with any owner-added lines appended.
 * Defaults are never removed, so a category always has content. The core chat
 * renders one line from this catalogue; the timing helpers below remain exported
 * for compatibility with the admin settings and existing integrations.
 */
export function resolveStatusMessages(type: CabiStatusType, overrides?: CabiStatusOverrides | null): string[] {
  const defaults = cabiStatusDefaults[type];
  const extra = (overrides?.[type] ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 120);
  return [...defaults, ...extra];
}

/**
 * Rotation timing, in milliseconds.
 *
 * The first line appears immediately; the second follows after a slightly longer
 * beat, and every line after that lands inside a 3-5s window. The variation is
 * what stops the rotation reading as a metronome.
 */
export const cabiStatusTiming = {
  firstDelayMs: 0,
  secondDelayMinMs: 2_500,
  secondDelayMaxMs: 4_000,
  steadyDelayMinMs: 3_000,
  steadyDelayMaxMs: 5_000,
  /** Elapsed time after which the "still working" line takes over. */
  patientAfterMs: 15_000,
  /** Elapsed time after which the longer-wait line takes over. */
  extendedAfterMs: 30_000,
} as const;

/** A random integer in `[min, max]`. Injected randomness keeps it testable. */
function randomBetween(min: number, max: number, random: () => number): number {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

/** The delay before the next rotation, given how many lines have been shown. */
export function nextRotationDelayMs(shownCount: number, random: () => number = Math.random): number {
  if (shownCount <= 0) return cabiStatusTiming.firstDelayMs;
  if (shownCount === 1) return randomBetween(cabiStatusTiming.secondDelayMinMs, cabiStatusTiming.secondDelayMaxMs, random);
  return randomBetween(cabiStatusTiming.steadyDelayMinMs, cabiStatusTiming.steadyDelayMaxMs, random);
}

/**
 * Picks a line that is not the one currently shown.
 *
 * Returns the only line when a category somehow has one, rather than looping
 * forever looking for a different one.
 */
export function pickNextMessage(messages: readonly string[], current?: string | null, random: () => number = Math.random): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0];
  const candidates = current ? messages.filter((message) => message !== current) : messages;
  return candidates[Math.floor(random() * candidates.length)] ?? messages[0];
}

/**
 * The line to show given how long the activity has been running.
 *
 * Escalation replaces the rotation rather than being interleaved into it: after a
 * point, the honest thing to say is that it is taking a while.
 */
export function escalatedMessage(elapsedMs: number): string | null {
  if (elapsedMs >= cabiStatusTiming.extendedAfterMs) return cabiLongWait.extended;
  if (elapsedMs >= cabiStatusTiming.patientAfterMs) return cabiLongWait.patient;
  return null;
}
