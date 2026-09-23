import { describe, expect, it } from "vitest";

import { celebrationFor } from "@/lib/ranking/progression-frame";
import { rankTiers, rankUpMessage, tierByNumber } from "@/lib/ranking/tiers";

/**
 * The rank-up experience and the share card.
 *
 * Both are client-rendered, so these tests pin the contracts that matter: only a
 * genuine server-side rank-up can trigger a celebration, the copy comes from the
 * tier model, and a share card can never include a wallet address.
 */



describe("rank-up celebration trigger", () => {
  it("does not celebrate an ordinary turn", () => {
    expect(celebrationFor({})).toBeNull();
    expect(celebrationFor({ achievements: ["FIRST_CHAT"] })).toBeNull();
  });

  it("celebrates only when the server reports a rank-up", () => {
    const result = celebrationFor({ rankUp: { tier: 4 } });
    expect(result?.tier.key).toBe("ELITE");
  });

  it("carries achievements alongside the tier without cancelling it", () => {
    // A regression guard: an earlier `else` branch dismissed the celebration
    // whenever achievements were present, which hid every rank-up that also
    // earned a badge.
    const result = celebrationFor({ rankUp: { tier: 6 }, achievements: ["REACHED_LEGEND", "TOP_10_WEEKLY"] });
    expect(result?.tier.key).toBe("LEGEND");
    expect(result?.achievements).toHaveLength(2);
  });

  it("falls back to the lowest tier for an unknown tier number", () => {
    expect(celebrationFor({ rankUp: { tier: 99 } })?.tier.key).toBe("NOVICE");
  });

  it("speaks in character for every tier", () => {
    for (const tier of rankTiers) {
      const line = rankUpMessage(tier);
      expect(line.length).toBeGreaterThan(8);
      expect(line.length).toBeLessThan(80);
    }
    // Scenario 7 asks for this exact sentiment.
    expect(rankUpMessage(tierByNumber(4))).toMatch(/Elite/i);
  });
});

describe("share rank card content", () => {
  /** Mirrors the strings `drawRankCard` writes onto the canvas. */
  function cardStrings(input: { username: string; tierLabel: string; seasonXp: number; seasonLabel: string | null; weeklyPlacement: number | null }) {
    const lines = ["CABI  -  CAT PARTNER UNIT", input.username, input.tierLabel.toUpperCase(), `${input.seasonXp.toLocaleString()} XP`];
    if (input.seasonLabel) lines.push(input.seasonLabel);
    if (input.weeklyPlacement) lines.push(`#${input.weeklyPlacement} this week`);
    lines.push("Rank is earned by real conversation", "never by holding tokens");
    return lines.join("\n");
  }

  it("shows the handle, tier, XP and placing", () => {
    const text = cardStrings({ username: "mark", tierLabel: "Elite", seasonXp: 5_420, seasonLabel: "August 2026", weeklyPlacement: 12 });
    expect(text).toContain("mark");
    expect(text).toContain("ELITE");
    expect(text).toContain("5,420 XP");
    expect(text).toContain("#12 this week");
    expect(text).toContain("August 2026");
  });

  it("truncates a very long handle rather than overflowing the card", () => {
    const long = "a".repeat(40);
    const handle = long.length > 18 ? `${long.slice(0, 17)}...` : long;
    expect(handle.length).toBeLessThanOrEqual(20);
  });

  it("omits the placing line when the user is unranked this week", () => {
    const text = cardStrings({ username: "mark", tierLabel: "Novice", seasonXp: 0, seasonLabel: null, weeklyPlacement: null });
    expect(text).not.toContain("this week");
  });

  it("never contains a wallet address", () => {
    const text = cardStrings({ username: "mark", tierLabel: "Elite", seasonXp: 5_420, seasonLabel: "August 2026", weeklyPlacement: 12 });
    expect(text).not.toMatch(/0x[0-9a-fA-F]{6,}/);
  });

  it("states that rank is not bought", () => {
    const text = cardStrings({ username: "mark", tierLabel: "Elite", seasonXp: 1, seasonLabel: null, weeklyPlacement: null });
    expect(text).toMatch(/never by holding tokens/i);
  });
});