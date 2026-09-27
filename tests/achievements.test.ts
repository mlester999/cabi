import { describe, expect, it } from "vitest";

import { achievementCodes, achievementCopy, qualifiedAchievements } from "@/lib/ranking/achievements";

/**
 * Achievements are permanent, like lifetime rank. These tests pin
 * the qualification rules, which are the only thing standing between a client
 * and a self-awarded badge.
 */

const base = { lifetimeXp: 0, tierNumber: 1, imageCount: 0, memoryCount: 0, messageCount: 0, bestWeeklyPlacement: null, bestMonthlyPlacement: null };

describe("achievement catalogue", () => {
  it("keeps a focused permanent milestone catalogue", () => {
    expect(achievementCodes).toHaveLength(17);
  });

  it("has copy for every code", () => {
    for (const code of achievementCodes) {
      const copy = achievementCopy[code];
      expect(copy.label.length).toBeGreaterThan(2);
      expect(copy.description.length).toBeGreaterThan(6);
    }
  });

  it("has no wealth-related achievement", () => {
    const serialized = JSON.stringify(achievementCopy).toLowerCase();
    for (const banned of ["token", "cpu", "holder", "trade", "balance", "buy", "usd", "price"]) {
      expect(serialized).not.toContain(banned);
    }
  });
});

describe("qualification", () => {
  it("awards nothing to a brand new account", () => {
    expect(qualifiedAchievements(base)).toEqual([]);
  });

  it("awards FIRST_CHAT on the first message", () => {
    expect(qualifiedAchievements({ ...base, messageCount: 1 })).toContain("FIRST_CHAT");
  });

  it("awards chat and memory milestones only at their real counts", () => {
    expect(qualifiedAchievements({ ...base, messageCount: 99 })).not.toContain("HUNDRED_MESSAGES");
    expect(qualifiedAchievements({ ...base, messageCount: 100 })).toContain("HUNDRED_MESSAGES");
    expect(qualifiedAchievements({ ...base, memoryCount: 1 })).toContain("FIRST_MEMORY");
    expect(qualifiedAchievements({ ...base, memoryCount: 9 })).not.toContain("TEN_MEMORIES");
    expect(qualifiedAchievements({ ...base, memoryCount: 10 })).toContain("TEN_MEMORIES");
  });

  it("awards HUNDRED_XP at the threshold, not before", () => {
    expect(qualifiedAchievements({ ...base, lifetimeXp: 99 })).not.toContain("HUNDRED_XP");
    expect(qualifiedAchievements({ ...base, lifetimeXp: 100 })).toContain("HUNDRED_XP");
  });

  it("awards FIRST_IMAGE only after a successful generation", () => {
    expect(qualifiedAchievements({ ...base, imageCount: 0 })).not.toContain("FIRST_IMAGE");
    expect(qualifiedAchievements({ ...base, imageCount: 1 })).toContain("FIRST_IMAGE");
    expect(qualifiedAchievements({ ...base, imageCount: 24 })).not.toContain("TWENTY_FIVE_IMAGES");
    expect(qualifiedAchievements({ ...base, imageCount: 25 })).toContain("TWENTY_FIVE_IMAGES");
  });

  it("awards placing achievements only inside the cutoffs", () => {
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 101 })).not.toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 100 })).toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 11 })).toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 11 })).not.toContain("TOP_10_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 10 })).toContain("TOP_10_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 1 })).toContain("WEEKLY_WINNER");
    expect(qualifiedAchievements({ ...base, bestMonthlyPlacement: 10 })).toContain("TOP_10_MONTHLY");
    expect(qualifiedAchievements({ ...base, bestMonthlyPlacement: 1 })).toContain("MONTHLY_WINNER");
  });

  it("awards the tier achievements cumulatively and never downgrades", () => {
    expect(qualifiedAchievements({ ...base, tierNumber: 2 })).toContain("REACHED_FAMILIAR");
    expect(qualifiedAchievements({ ...base, tierNumber: 3 })).toContain("REACHED_COMPANION");
    expect(qualifiedAchievements({ ...base, tierNumber: 3 })).not.toContain("REACHED_ELITE");
    expect(qualifiedAchievements({ ...base, tierNumber: 4 })).toEqual(expect.arrayContaining(["REACHED_ELITE"]));
    expect(qualifiedAchievements({ ...base, tierNumber: 4 })).not.toContain("REACHED_MASTER");
    // Reaching Legend also satisfies Elite and Master.
    const legend = qualifiedAchievements({ ...base, tierNumber: 6 });
    expect(legend).toEqual(expect.arrayContaining(["REACHED_ELITE", "REACHED_MASTER", "REACHED_LEGEND"]));
  });

  it("is a pure function of its input, so it cannot be influenced by a client", () => {
    const signals = { ...base, lifetimeXp: 5_000, tierNumber: 5, imageCount: 3, messageCount: 400, bestWeeklyPlacement: 4 };
    expect(qualifiedAchievements(signals)).toEqual(qualifiedAchievements({ ...signals }));
  });

  it("returns only codes from the catalogue", () => {
    const all = qualifiedAchievements({ ...base, lifetimeXp: 99_999, tierNumber: 6, imageCount: 25, memoryCount: 10, messageCount: 900, bestWeeklyPlacement: 1, bestMonthlyPlacement: 1 });
    for (const code of all) expect(achievementCodes).toContain(code);
    expect(all).toHaveLength(17);
  });
});
