/**
 * Cabi's mood.
 *
 * Mood is a small, persisted presentation state. It changes her status line, the
 * ambient glow, and idle animation - not her personality. The model is told the
 * current mood as tone guidance only, so she never turns into a different
 * character between messages.
 *
 * Mood is derived from real signals (local time of day, chat activity, a bond
 * milestone, an explicit user preference) rather than randomised per message, so
 * it stays stable instead of flickering.
 */

export type CabiMood = "cozy" | "playful" | "curious" | "focused" | "sleepy" | "excited" | "calm";

export const cabiMoods: readonly CabiMood[] = ["cozy", "playful", "curious", "focused", "sleepy", "excited", "calm"] as const;

export type MoodPresentation = {
  mood: CabiMood;
  label: string;
  /** Short in-character status line. */
  status: string;
  /** Accent used for the glow and status dot. */
  accent: string;
  /** Idle animation intensity; the CSS layer still honours reduced motion. */
  energy: "low" | "medium" | "high";
};

export const moodPresentation: Record<CabiMood, MoodPresentation> = {
  cozy: { mood: "cozy", label: "Cozy", status: "Hanging out with you.", accent: "#c4b5fd", energy: "low" },
  playful: { mood: "playful", label: "Playful", status: "Okayyy, what are we doing?", accent: "#a78bfa", energy: "high" },
  curious: { mood: "curious", label: "Curious", status: "Tell me more about that.", accent: "#c4b5fd", energy: "medium" },
  focused: { mood: "focused", label: "Focused", status: "Reading your wallet.", accent: "#8b5cf6", energy: "low" },
  sleepy: { mood: "sleepy", label: "Sleepy", status: "It is late. I am still here though.", accent: "#8b5cf6", energy: "low" },
  excited: { mood: "excited", label: "Excited", status: "That is a good one.", accent: "#ddd6fe", energy: "high" },
  calm: { mood: "calm", label: "Calm", status: "Right here with you.", accent: "#c4b5fd", energy: "low" },
};

export type MoodSignals = {
  /** Chat state, so the ambient reacts to real activity. */
  phase?: "idle" | "thinking" | "streaming";
  /** Local hour (0-23) in the viewer's timezone. */
  hour?: number;
  /** Set when the last reply carried a bond milestone. */
  milestone?: boolean;
  /** Explicit override from the user's own mood preference. */
  preferred?: CabiMood | null;
};

/**
 * Chooses a mood from real signals, in priority order.
 *
 * A user preference always wins, then transient chat activity, then time of day.
 * The result is stable for a given input, which is what keeps her from feeling
 * random.
 */
export function inferMood(signals: MoodSignals = {}): CabiMood {
  if (signals.preferred && cabiMoods.includes(signals.preferred)) return signals.preferred;
  if (signals.milestone) return "excited";
  if (signals.phase === "thinking") return "curious";
  if (signals.phase === "streaming") return "playful";
  const hour = signals.hour;
  if (typeof hour === "number") {
    if (hour >= 23 || hour < 6) return "sleepy";
    if (hour >= 6 && hour < 10) return "calm";
  }
  return "cozy";
}

export function moodFor(mood: CabiMood): MoodPresentation {
  return moodPresentation[mood] ?? moodPresentation.cozy;
}

/** Tone guidance handed to the model. Deliberately small. */
export function moodPromptHint(mood: CabiMood): string {
  switch (mood) {
    case "playful": return "Right now you are in a playful mood: light, quick, a little teasing.";
    case "curious": return "Right now you are curious: ask one short follow-up if it genuinely helps.";
    case "focused": return "Right now you are focused: be brief, concrete, and skip the banter.";
    case "sleepy": return "It is late for the user. Be warm and a little quieter than usual.";
    case "excited": return "Something good just happened between you two. Let a little of that show, briefly.";
    case "calm": return "Right now you are calm and steady.";
    case "cozy":
    default: return "Right now you are cozy: warm, relaxed, present.";
  }
}