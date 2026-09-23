import { describe, expect, it } from "vitest";

import {
  applyDailyCap,
  evaluateChatXp,
  evaluateImageXp,
  fingerprint,
  isNearDuplicate,
  normalizeForComparison,
  similarity,
  xpRules,
  type ChatSignals,
} from "@/lib/ranking/xp-rules";
import { defaultRankThresholds, rankProgress, rankTiers, rankUpMessage, tierByKey, tierByNumber, tierForXp } from "@/lib/ranking/tiers";

const NOW = 1_760_000_000_000;

function signals(overrides: Partial<ChatSignals> = {}): ChatSignals {
  return {
    message: "I have been reading about how bonding curves work, can you explain the difference?",
    recentUserMessages: [],
    recentTimestamps: [NOW],
    now: NOW,
    ...overrides,
  };
}

describe("xp normalisation and fingerprints", () => {
  it("folds case, punctuation and whitespace", () => {
    expect(normalizeForComparison("  Hello,   WORLD!! ")).toBe("hello world");
  });

  it("produces the same fingerprint for cosmetic variations", () => {
    expect(fingerprint("Hello there!")).toBe(fingerprint("hello   there"));
  });

  it("produces different fingerprints for different content", () => {
    expect(fingerprint("hello there")).not.toBe(fingerprint("hello there friend"));
  });

  it("scores similarity sensibly", () => {
    expect(similarity("hello world", "hello world")).toBe(1);
    expect(similarity("hello world", "goodbye moon")).toBeLessThan(0.3);
    expect(similarity("the quick brown fox", "the quick brown cat")).toBeGreaterThan(0.6);
    expect(similarity("", "anything")).toBe(0);
  });

  it("detects near duplicates but not genuinely different messages", () => {
    expect(isNearDuplicate("hello hello hello", ["hello hello hello"])).toBe(true);
    expect(isNearDuplicate("I built a new dashboard today", ["What is a bonding curve?"])).toBe(false);
  });
});

describe("chat xp: rewarding real conversation", () => {
  it("awards a meaningful band for an ordinary genuine message", () => {
    const decision = evaluateChatXp(signals());
    expect(decision.xp).toBeGreaterThanOrEqual(xpRules.meaningfulMin);
    expect(decision.xp).toBeLessThanOrEqual(xpRules.meaningfulMax);
    expect(["CHAT_MEANINGFUL", "CHAT_FOLLOWUP", "CHAT_HIGH_QUALITY", "MEMORY_INTERACTION", "FEATURE_DISCOVERY"]).toContain(decision.eventType);
  });

  it("caps a long substantive message at the high-quality ceiling", () => {
    const decision = evaluateChatXp(signals({ message: "a real sentence about my project. ".repeat(20) }));
    expect(decision.xp).toBeLessThanOrEqual(xpRules.highQualityMax);
    expect(decision.eventType).toBe("CHAT_HIGH_QUALITY");
  });

  it("rewards a follow-up more than a standalone prompt", () => {
    const standalone = evaluateChatXp(signals({ isFollowUp: false }));
    const followUp = evaluateChatXp(signals({ isFollowUp: true }));
    expect(followUp.xp).toBeGreaterThan(standalone.xp);
    expect(followUp.reasonCode).toBe("FOLLOW_UP");
  });

  it("gives a small bonus for genuine feature use", () => {
    const plain = evaluateChatXp(signals({ usedFeature: false }));
    const featured = evaluateChatXp(signals({ usedFeature: true }));
    expect(featured.xp).toBeGreaterThan(plain.xp);
  });

  it("does not reward a wall of text without limit", () => {
    const short = evaluateChatXp(signals({ message: "Tell me how memory retrieval works in Cabi, please." }));
    const huge = evaluateChatXp(signals({ message: "x".repeat(9_000) }));
    // The huge message is caught as low-effort repetition rather than paid out.
    expect(huge.xp).toBeLessThanOrEqual(short.xp + xpRules.highQualityMax);
  });
});

describe("chat xp: never punishing people", () => {
  it("gives zero, not negative, for a genuinely minimal message", () => {
    // Below the length and word floor: acknowledgements and single words.
    for (const message of ["why?", "thanks", "no", "ok", "yes please"]) {
      const decision = evaluateChatXp(signals({ message }));
      expect(decision.xp).toBe(0);
    }
  });

  it("still pays the floor band for a short but real question", () => {
    // "what about it" clears the floor, so it earns the minimum rather than
    // nothing. Short does not mean worthless.
    expect(evaluateChatXp(signals({ message: "what about it" })).xp).toBeGreaterThanOrEqual(xpRules.meaningfulMin);
  });

  it("never returns a negative value for any ordinary conversational message", () => {
    const ordinary = [
      "hi", "hello", "hey", "hmm", "?", "...", "cool", "wow", "I do not know",
      "can you explain that again", "that makes sense", "no thanks",
    ];
    for (const message of ordinary) {
      expect(evaluateChatXp(signals({ message })).xp).toBeGreaterThanOrEqual(0);
    }
  });

  it("never penalises emotional or sensitive content", () => {
    const messages = [
      "I am having a really hard week honestly and I do not know what to do",
      "my dog died yesterday and I am sad",
      "I disagree with you about that completely",
      "i cant spell very well sorry",
    ];
    for (const message of messages) {
      const decision = evaluateChatXp(signals({ message }));
      expect(decision.xp).toBeGreaterThanOrEqual(0);
    }
  });

  it("prefers zero over negative when the signal is ambiguous", () => {
    const decision = evaluateChatXp(signals({ message: "hello hello" }));
    expect(decision.xp).toBe(0);
  });
});

describe("chat xp: anti-farming", () => {
  it("gives zero for a repeated identical message (scenario 3)", () => {
    const repeated = evaluateChatXp(signals({
      message: "hello",
      recentUserMessages: ["hello", "hello", "hello", "hello"],
    }));
    expect(repeated.xp).toBe(0);
    expect(repeated.reasonCode).toBe("DUPLICATE_MESSAGE");
  });

  it("gives zero for a reworded near-duplicate", () => {
    const decision = evaluateChatXp(signals({
      message: "hello there friend how are you today",
      recentUserMessages: ["hello there friend, how are you today?"],
    }));
    expect(decision.xp).toBe(0);
    expect(decision.reasonCode).toBe("DUPLICATE_MESSAGE");
  });

  it("applies a small penalty only for unambiguous flooding", () => {
    const burst = Array.from({ length: xpRules.floodThreshold }, (_, index) => NOW - index * 500);
    const decision = evaluateChatXp(signals({ recentTimestamps: burst }));
    expect(decision.eventType).toBe("SPAM_RATE_LIMIT");
    expect(decision.xp).toBeLessThan(0);
    expect(decision.reasonCode).toBe("FLOODING");
  });

  it("does not treat a normal pace as flooding", () => {
    const paced = [NOW, NOW - 60_000, NOW - 120_000, NOW - 180_000, NOW - 240_000];
    const decision = evaluateChatXp(signals({ recentTimestamps: paced }));
    expect(decision.reasonCode).not.toBe("FLOODING");
  });

  it("keeps any single award small enough that grinding is pointless", () => {
    const best = evaluateChatXp(signals({
      message: "a genuine thoughtful message about my project and what I am building next. ".repeat(8),
      isFollowUp: true,
      usedFeature: true,
      memoryInteraction: true,
    }));
    // Far below the daily cap, so reaching a high tier takes real days.
    expect(best.xp).toBeLessThan(xpRules.dailyCap / 10);
  });
});

describe("daily cap", () => {
  it("lets a normal award through untouched", () => {
    expect(applyDailyCap({ eventType: "CHAT_MEANINGFUL", xp: 8, reasonCode: "MEANINGFUL_MESSAGE", label: null }, 0)).toEqual({ xp: 8, capped: false });
  });

  it("truncates an award that would exceed the cap", () => {
    expect(applyDailyCap({ eventType: "CHAT_MEANINGFUL", xp: 8, reasonCode: "MEANINGFUL_MESSAGE", label: null }, 496)).toEqual({ xp: 4, capped: true });
  });

  it("blocks awards once the cap is reached", () => {
    expect(applyDailyCap({ eventType: "CHAT_MEANINGFUL", xp: 8, reasonCode: "MEANINGFUL_MESSAGE", label: null }, xpRules.dailyCap)).toEqual({ xp: 0, capped: true });
  });

  it("never inflates a penalty through the cap", () => {
    expect(applyDailyCap({ eventType: "SPAM_RATE_LIMIT", xp: -2, reasonCode: "FLOODING", label: null }, 500)).toEqual({ xp: -2, capped: false });
  });

  it("cannot reach the top tier in a single day", () => {
    const daysToLegend = Math.ceil(defaultRankThresholds.LEGEND / xpRules.dailyCap);
    expect(daysToLegend).toBeGreaterThanOrEqual(30);
  });
});

describe("image xp", () => {
  it("rewards only the first image of the day", () => {
    expect(evaluateImageXp(0).xp).toBe(xpRules.firstImageOfDay);
    expect(evaluateImageXp(1).xp).toBe(0);
    expect(evaluateImageXp(9).xp).toBe(0);
  });
});

describe("rank tiers", () => {
  it("defines exactly six tiers in order", () => {
    expect(rankTiers).toHaveLength(6);
    expect(rankTiers.map((tier) => tier.key)).toEqual(["NOVICE", "EXPLORER", "COMPANION", "ELITE", "MASTER", "LEGEND"]);
    expect(rankTiers.map((tier) => tier.tier)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("uses the documented default thresholds", () => {
    expect(rankTiers.map((tier) => tier.threshold)).toEqual([0, 500, 1_500, 4_000, 9_000, 18_000]);
  });

  it("maps xp to the right tier at every boundary", () => {
    expect(tierForXp(0).key).toBe("NOVICE");
    expect(tierForXp(499).key).toBe("NOVICE");
    expect(tierForXp(500).key).toBe("EXPLORER");
    expect(tierForXp(1_499).key).toBe("EXPLORER");
    expect(tierForXp(1_500).key).toBe("COMPANION");
    expect(tierForXp(4_000).key).toBe("ELITE");
    expect(tierForXp(9_000).key).toBe("MASTER");
    expect(tierForXp(17_999).key).toBe("MASTER");
    expect(tierForXp(18_000).key).toBe("LEGEND");
    expect(tierForXp(999_999).key).toBe("LEGEND");
  });

  it("honours season-specific thresholds", () => {
    expect(tierForXp(600, { EXPLORER: 1_000 }).key).toBe("NOVICE");
    expect(tierForXp(1_000, { EXPLORER: 1_000 }).key).toBe("EXPLORER");
  });

  it("does not make Legend easy", () => {
    expect(defaultRankThresholds.LEGEND).toBeGreaterThanOrEqual(18_000);
    // A very active day at the cap still takes weeks.
    expect(Math.ceil(defaultRankThresholds.LEGEND / xpRules.dailyCap)).toBeGreaterThanOrEqual(30);
  });

  it("reports progress within the current band", () => {
    const mid = rankProgress(1_000);
    expect(mid.current.key).toBe("EXPLORER");
    expect(mid.next?.key).toBe("COMPANION");
    expect(mid.toNext).toBe(500);
    expect(mid.percent).toBe(50);

    const top = rankProgress(50_000);
    expect(top.next).toBeNull();
    expect(top.percent).toBe(100);
    expect(top.toNext).toBe(0);
  });

  it("clamps odd input", () => {
    expect(rankProgress(-50).xp).toBe(0);
    expect(rankProgress(-50).current.key).toBe("NOVICE");
  });

  it("resolves by number and key, falling back safely", () => {
    expect(tierByNumber(4).key).toBe("ELITE");
    expect(tierByNumber(99).key).toBe("NOVICE");
    expect(tierByKey("master")?.tier).toBe(5);
    expect(tierByKey("nonsense")).toBeNull();
  });

  it("gives every tier a distinct badge and an in-character rank-up line", () => {
    const accents = new Set(rankTiers.map((tier) => tier.accent));
    expect(accents.size).toBe(6);
    for (const tier of rankTiers) {
      expect(tier.badgeClass.length).toBeGreaterThan(10);
      expect(rankUpMessage(tier).length).toBeGreaterThan(5);
    }
  });

  it("has no wealth input anywhere in the tier model", () => {
    const serialized = JSON.stringify({ rankTiers, defaultRankThresholds }).toLowerCase();
    for (const banned of ["balance", "holdings", "token", "trade", "volume", "usd", "price", "cpu"]) {
      expect(serialized).not.toContain(banned);
    }
  });
});