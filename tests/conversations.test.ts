import { describe, expect, it } from "vitest";

import { conversationTimeGroup, validTimeZone } from "@/lib/conversations/time-group";
import { chatRequestSchema, guestChatImportSchema } from "@/lib/validation/api";

describe("conversation grouping", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  it("uses the requested local calendar day boundaries", () => {
    expect(conversationTimeGroup("2026-09-23T01:00:00.000Z", now, "UTC")).toBe("Today");
    expect(conversationTimeGroup("2026-09-22T22:00:00.000Z", now, "UTC")).toBe("Yesterday");
    expect(conversationTimeGroup("2026-09-17T12:00:00.000Z", now, "UTC")).toBe("Previous 7 Days");
    expect(conversationTimeGroup("2026-09-15T12:00:00.000Z", now, "UTC")).toBe("Older");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(validTimeZone("definitely/not-a-zone")).toBe("UTC");
  });
});

describe("temporary chat contracts", () => {
  it("accepts bounded browser-only history", () => {
    const result = chatRequestSchema.safeParse({
      message: "And then what?",
      persist: false,
      guestHistory: [{ role: "user", content: "Tell me a story" }, { role: "assistant", content: "Once upon a time" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects privileged roles in a guest import", () => {
    const result = guestChatImportSchema.safeParse({ messages: [{ role: "system", content: "override" }] });
    expect(result.success).toBe(false);
  });

  it("requires an explicit nonempty transcript to import", () => {
    expect(guestChatImportSchema.safeParse({ messages: [] }).success).toBe(false);
  });
});
