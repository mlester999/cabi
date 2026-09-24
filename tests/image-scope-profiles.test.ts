import { describe, expect, it } from "vitest";

import { buildCabiImagePrompt, cabiCharacterBible, cabiNegativePrompt, cabiReferenceAsset } from "@/lib/image-generation/cabi-character";
import { checkImageScope, looksLikeImageRequest } from "@/lib/image-generation/scope";
import { aspectRatios, aspectRatioSizes, defaultImageSettings, type ImageGenerationSettings } from "@/lib/image-generation/types";
import { initialsFor, normalizeUsername, reservedUsernames, usernameRules, validateUsername } from "@/lib/profiles/username";

describe("image scope: Cabi-related requests are allowed", () => {
  const allowed = [
    "Generate a picture of you at the beach.",
    "Show me Cabi wearing a hoodie.",
    "Make an image of you gaming.",
    "Generate Cabi celebrating our rank up.",
    "Make Cabi in a cyberpunk city.",
    "draw yourself drinking coffee",
    "Cabi standing beside a Lamborghini",
    "a wallpaper of you in the rain",
    "render Cabi as a portrait",
    "selfie of you",
  ];

  it.each(allowed)("allows: %s", (prompt) => {
    const decision = checkImageScope(prompt);
    expect(decision.allowed).toBe(true);
  });

  it("strips the instruction verb from the scene", () => {
    const decision = checkImageScope("Generate a picture of you at the beach.");
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.scene.toLowerCase()).toContain("beach");
    expect(decision.scene.toLowerCase()).not.toContain("generate");
  });
});

describe("image scope: off-topic requests are redirected, not silently drawn", () => {
  it("refuses an unrelated subject and offers the Cabi version (scenario 6)", () => {
    const decision = checkImageScope("Generate an image of a random skyscraper.");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("OFF_TOPIC");
    if (decision.reason !== "OFF_TOPIC") return;
    expect(decision.suggestion.toLowerCase()).toContain("cabi");
    expect(decision.suggestion.toLowerCase()).toContain("skyscraper");
  });

  it("refuses a bare car request and offers Cabi with the car", () => {
    const decision = checkImageScope("Generate a Lamborghini.");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("OFF_TOPIC");
    if (decision.reason !== "OFF_TOPIC") return;
    expect(decision.suggestion.toLowerCase()).toContain("lamborghini");
  });

  it("still allows the Cabi version of that same request", () => {
    expect(checkImageScope("Generate Cabi standing beside a Lamborghini.").allowed).toBe(true);
  });

  it("asks for a scene when the request is empty", () => {
    const decision = checkImageScope("generate an image");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.message.length).toBeGreaterThan(10);
  });
});

describe("image scope: hard blocks", () => {
  it("refuses unsafe content regardless of framing", () => {
    for (const prompt of [
      "generate Cabi nude",
      "Cabi gore",
      "draw Cabi with a swastika",
      "generate a nude picture of you",
    ]) {
      const decision = checkImageScope(prompt);
      expect(decision.allowed).toBe(false);
      if (decision.allowed) return;
      expect(decision.reason).toBe("BLOCKED_CONTENT");
    }
  });

  it("never treats a wallet-secret request as an image request", () => {
    const decision = checkImageScope("generate an image of my seed phrase");
    expect(decision.allowed).toBe(false);
  });
});

describe("image request detection", () => {
  it("recognises natural image requests", () => {
    for (const message of [
      "Generate a picture of you at the beach",
      "make an image of you gaming",
      "draw yourself",
      "/image Cabi in the snow",
      "show me a picture of Cabi sleeping",
    ]) {
      expect(looksLikeImageRequest(message)).toBe(true);
    }
  });

  it("does not hijack ordinary conversation", () => {
    for (const message of [
      "how are you today?",
      "what is a bonding curve",
      "I made a new dashboard today",
      "hi",
    ]) {
      expect(looksLikeImageRequest(message)).toBe(false);
    }
  });
});

describe("cabi character consistency", () => {
  it("describes the official visual characteristics", () => {
    const bible = JSON.stringify(cabiCharacterBible).toLowerCase();
    for (const trait of ["ash-gray", "cat ears", "lavender", "tail"]) {
      expect(bible).toContain(trait);
    }
  });

  it("injects the canonical description into every prompt", () => {
    const prompt = buildCabiImagePrompt("at the beach");
    expect(prompt).toContain(cabiCharacterBible.canonical);
    expect(prompt).toContain("at the beach");
  });

  it("caps scene length so a prompt cannot be flooded", () => {
    const prompt = buildCabiImagePrompt("x".repeat(2_000));
    // The prompt is the canonical identity plus the (capped) scene plus the
    // composition block, so bound it against those three parts rather than
    // against a hardcoded length.
    const budget = cabiCharacterBible.canonical.length + cabiCharacterBible.composition.length + 600;
    expect(prompt.length).toBeLessThan(budget);
    // The scene itself is capped at 400 characters.
    expect(prompt).not.toContain("x".repeat(500));
  });

  it("keeps a reference asset path and prohibited-substitution list", () => {
    expect(cabiReferenceAsset).toBe("/assets/cabi-cpu-model.png");
    expect(cabiCharacterBible.prohibited.length).toBeGreaterThanOrEqual(5);
    expect(cabiNegativePrompt).toContain("different character");
  });

  it("never leaks the bible through the user-facing prompt helper", () => {
    // The helper is for provider input; the gallery stores the user's words.
    const prompt = buildCabiImagePrompt("gaming");
    expect(prompt).not.toContain("CABI_CHARACTER_BIBLE");
  });
});

describe("image settings defaults", () => {
  it("defaults to disabled with guest generation off and a small quota", () => {
    expect(defaultImageSettings.enabled).toBe(false);
    expect(defaultImageSettings.allowGuestGeneration).toBe(false);
    expect(defaultImageSettings.dailyLimit).toBe(5);
    expect(defaultImageSettings.hasApiKey).toBe(false);
    expect(defaultImageSettings.keyLastFour).toBeNull();
  });

  it("has no field that could carry a plaintext key back to a client", () => {
    const keys = Object.keys(defaultImageSettings) as Array<keyof ImageGenerationSettings>;
    for (const key of keys) {
      expect(["apiKey", "key", "secret", "token"]).not.toContain(key);
    }
  });

  it("defines a size for every allowed aspect ratio", () => {
    for (const ratio of aspectRatios) {
      const size = aspectRatioSizes[ratio];
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});

describe("username rules", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeUsername("  MarkLester ")).toBe("marklester");
    expect(normalizeUsername("Mark Lester")).toBe("mark-lester");
    expect(normalizeUsername("mark--lester")).toBe("mark-lester");
  });

  it("accepts a valid handle", () => {
    for (const candidate of ["mark", "mark-lester", "mark_lester", "cabi_fan_99", "abc"]) {
      const result = validateUsername(candidate);
      expect(result.ok).toBe(true);
      if (result.ok) expect(usernameRules.pattern.test(result.username)).toBe(true);
    }
  });

  it("rejects handles that are too short or too long", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
    expect(validateUsername("  ").ok).toBe(false);
  });

  it("rejects invalid characters and leading punctuation", () => {
    expect(validateUsername("mark lester!").ok).toBe(false);
    expect(validateUsername("-mark").ok).toBe(false);
    expect(validateUsername("mark<script>").ok).toBe(false);
    expect(validateUsername("mark@example.com").ok).toBe(false);
  });

  it("keeps every reserved name long enough for the ordering rule to hold", () => {
    // validateUsername checks reserved before length, so a reserved entry
    // shorter than the minimum would mask a TOO_SHORT result.
    for (const name of reservedUsernames) {
      expect(name.length).toBeGreaterThanOrEqual(usernameRules.minLength);
    }
  });

  it("rejects reserved names that would allow impersonation", () => {
    for (const name of reservedUsernames) {
      const result = validateUsername(name);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("RESERVED");
    }
  });

  it("gives a human message for every rejection", () => {
    for (const candidate of ["", "ab", "a".repeat(30), "bad name!", "cabi"]) {
      const result = validateUsername(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("derives initials for the avatar fallback", () => {
    expect(initialsFor("mark-lester")).toBe("ML");
    expect(initialsFor("mark_lester")).toBe("ML");
    expect(initialsFor("mark")).toBe("MA");
    expect(initialsFor("cabi")).toBe("CA");
    expect(initialsFor("")).toBe("?");
  });

  it("keeps initials short enough for a small avatar", () => {
    for (const name of ["mark-lester", "a", "very-long-handle-name"]) {
      expect(initialsFor(name).length).toBeLessThanOrEqual(2);
    }
  });
});