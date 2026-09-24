import { describe, expect, it } from "vitest";

import {
  cabiCharacterBibleDefaults,
  parseCabiCharacterBible,
  sanitizeVisualGuidance,
} from "@/lib/cabi/character-bible.server";

describe("admin Cabi visual guidance", () => {
  it.each([
    "never childlike",
    "avoid unsafe content",
    "no sexual themes",
    "use the provider model",
  ])("rejects policy or provider wording: %s", (value) => {
    expect(() => sanitizeVisualGuidance(value, "artDirection")).toThrow("VISUAL_GUIDANCE_ONLY");
  });

  it("falls back to the shipped bible when stored guidance is unsafe", () => {
    expect(parseCabiCharacterBible({ artDirection: "never childlike", negative: "blurry" })).toEqual(cabiCharacterBibleDefaults);
  });

  it("accepts visual direction and quality-only negatives", () => {
    expect(parseCabiCharacterBible({
      artDirection: "soft watercolour finish",
      negative: "blurry, low resolution, text artifacts",
    })).toEqual({
      artDirection: "soft watercolour finish",
      negative: "blurry, low resolution, text artifacts",
      customized: true,
    });
  });
});
