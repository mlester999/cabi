import { describe, expect, it } from "vitest";

import { bondFromPoints } from "@/lib/bond";
import { cabiMoods, inferMood, moodFor, moodPromptHint, moodPresentation } from "@/lib/cabi/mood";

describe("cabi mood", () => {
  it("exposes a presentation for every mood", () => {
    for (const mood of cabiMoods) {
      const presentation = moodPresentation[mood];
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.status.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(presentation.energy);
      expect(presentation.accent).toMatch(/^#[0-9a-f]{6}$/iu);
    }
  });

  it("lets an explicit user preference win", () => {
    expect(inferMood({ preferred: "sleepy", phase: "thinking", hour: 14 })).toBe("sleepy");
  });

  it("ignores an unknown preference instead of trusting it", () => {
    expect(inferMood({ preferred: "manic" as never })).toBe("cozy");
  });

  it("reacts to real chat activity", () => {
    expect(inferMood({ phase: "thinking", hour: 14 })).toBe("curious");
    expect(inferMood({ phase: "streaming", hour: 14 })).toBe("playful");
  });

  it("marks a milestone as excited, above activity", () => {
    expect(inferMood({ milestone: true, phase: "thinking" })).toBe("excited");
  });

  it("is sleepy late and calm early, and stable otherwise", () => {
    expect(inferMood({ hour: 2 })).toBe("sleepy");
    expect(inferMood({ hour: 23 })).toBe("sleepy");
    expect(inferMood({ hour: 7 })).toBe("calm");
    expect(inferMood({ hour: 15 })).toBe("cozy");
    // Same input, same result: mood must not flicker between renders.
    expect(inferMood({ hour: 15 })).toBe(inferMood({ hour: 15 }));
  });

  it("falls back safely for an unknown mood", () => {
    expect(moodFor("nonsense" as never).mood).toBe("cozy");
  });

  it("gives the model bounded tone guidance", () => {
    for (const mood of cabiMoods) {
      const hint = moodPromptHint(mood);
      expect(hint.length).toBeGreaterThan(10);
      expect(hint.length).toBeLessThan(200);
    }
  });
});

describe("bond levels", () => {
  const levels = ["Stranger", "New Friend", "Familiar", "Buddy", "Trusted Human", "Favorite Human", "Close Companion", "Partner", "Best Partner", "Forever CPU"];

  it("starts at level 1 with zero points", () => {
    const bond = bondFromPoints(0);
    expect(bond.level).toBe(1);
    expect(bond.label).toBe("Stranger");
    expect(bond.points).toBe(0);
    expect(bond.progress).toBe(0);
  });

  it("uses the documented friendly level names", () => {
    for (const [index, label] of levels.entries()) {
      const points = index === 0 ? 0 : (index) ** 2 * 18 + 1;
      expect(bondFromPoints(points).label).toBe(label);
    }
  });

  it("never exceeds level 10 and caps progress at 100", () => {
    const bond = bondFromPoints(1_000_000);
    expect(bond.level).toBe(10);
    expect(bond.label).toBe("Forever CPU");
    expect(bond.progress).toBe(100);
  });

  it("clamps negative points instead of going backwards", () => {
    const bond = bondFromPoints(-500);
    expect(bond.points).toBe(0);
    expect(bond.level).toBe(1);
  });

  it("keeps progress within 0-100 at every boundary", () => {
    for (const points of [0, 1, 17, 18, 71, 72, 161, 162, 1_000, 5_000]) {
      const bond = bondFromPoints(points);
      expect(bond.progress).toBeGreaterThanOrEqual(0);
      expect(bond.progress).toBeLessThanOrEqual(100);
      expect(bond.level).toBeGreaterThanOrEqual(1);
      expect(bond.level).toBeLessThanOrEqual(10);
    }
  });
});