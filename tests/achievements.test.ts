import { describe, expect, it } from "vitest";

import { achievementCodes, achievementCopy, qualifiedAchievements } from "@/lib/ranking/achievements";

/**
 * Achievements are permanent, like lifetime rank. These tests pin
 * the qualification rules, which are the only thing standing between a client
 * and a self-awarded badge.
 */

const base = { lifetimeXp: 0, tierNumber: 1, imageCount: 0, messageCount: 0, bestWeeklyPlacement: null };

describe("achievement catalogue", () => {
  it("stays deliberately small", () => {
    expect(achievementCodes).toHaveLength(8);
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

  it("awards HUNDRED_XP at the threshold, not before", () => {
    expect(qualifiedAchievements({ ...base, lifetimeXp: 99 })).not.toContain("HUNDRED_XP");
    expect(qualifiedAchievements({ ...base, lifetimeXp: 100 })).toContain("HUNDRED_XP");
  });

  it("awards FIRST_IMAGE only after a successful generation", () => {
    expect(qualifiedAchievements({ ...base, imageCount: 0 })).not.toContain("FIRST_IMAGE");
    expect(qualifiedAchievements({ ...base, imageCount: 1 })).toContain("FIRST_IMAGE");
  });

  it("awards placing achievements only inside the cutoffs", () => {
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 101 })).not.toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 100 })).toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 11 })).toContain("TOP_100_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 11 })).not.toContain("TOP_10_WEEKLY");
    expect(qualifiedAchievements({ ...base, bestWeeklyPlacement: 10 })).toContain("TOP_10_WEEKLY");
  });

  it("awards the tier achievements cumulatively and never downgrades", () => {
    expect(qualifiedAchievements({ ...base, tierNumber: 3 })).not.toContain("REACHED_ELITE");
    expect(qualifiedAchievements({ ...base, tierNumber: 4 })).toEqual(expect.arrayContaining(["REACHED_ELITE"]));
    expect(qualifiedAchievements({ ...base, tierNumber: 4 })).not.toContain("REACHED_MASTER");
    // Reaching Legend also satisfies Elite and Master.
    const legend = qualifiedAchievements({ ...base, tierNumber: 6 });
    expect(legend).toEqual(expect.arrayContaining(["REACHED_ELITE", "REACHED_MASTER", "REACHED_LEGEND"]));
  });

  it("is a pure function of its input, so it cannot be influenced by a client", () => {
    const signals = { lifetimeXp: 5_000, tierNumber: 5, imageCount: 3, messageCount: 400, bestWeeklyPlacement: 4 };
    expect(qualifiedAchievements(signals)).toEqual(qualifiedAchievements({ ...signals }));
  });

  it("returns only codes from the catalogue", () => {
    const all = qualifiedAchievements({ lifetimeXp: 99_999, tierNumber: 6, imageCount: 9, messageCount: 900, bestWeeklyPlacement: 1 });
    for (const code of all) expect(achievementCodes).toContain(code);
    expect(all).toHaveLength(8);
  });
});
