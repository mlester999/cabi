import { describe, expect, it } from "vitest";

import {
  cabiFailureMessages,
  cabiLongWait,
  cabiRetryLabel,
  cabiStatusAnnouncements,
  cabiStatusDefaults,
  cabiStatusTiming,
  cabiStatusTypes,
  escalatedMessage,
  nextRotationDelayMs,
  pickNextMessage,
  resolveStatusMessages,
  type CabiStatusType,
} from "@/lib/cabi/status-messages";

/**
 * Cabi's activity messages.
 *
 * Three properties are load-bearing: a category can never end up with nothing to
 * say, the visible activity copy stays calm, and no message invents a completion
 * percentage.
 */

describe("message catalogues", () => {
  it("has built-in defaults for every activity", () => {
    for (const type of cabiStatusTypes) {
      // Every category ships with at least one line. Chat and image work use one
      // stable line so a single request does not look like stacked loaders.
      expect(cabiStatusDefaults[type].length).toBeGreaterThanOrEqual(1);
      for (const message of cabiStatusDefaults[type]) {
        expect(message.trim().length).toBeGreaterThan(0);
        expect(message.length).toBeLessThanOrEqual(120);
      }
    }
  });

  it("covers the activities the product names", () => {
    expect(cabiStatusTypes).toContain("CHAT_THINKING");
    expect(cabiStatusTypes).toContain("IMAGE_GENERATING");
    expect(cabiStatusTypes).toContain("MEMORY_LOADING");
    expect(cabiStatusTypes).toContain("WALLET_VERIFYING");
    expect(cabiStatusTypes).toContain("PROFILE_SAVING");
    expect(cabiStatusTypes).toContain("IMAGE_SAVING");
  });

  it("uses one concise line for chat and image work", () => {
    expect(cabiStatusDefaults.CHAT_THINKING).toEqual(["Cabi is thinking…"]);
    expect(cabiStatusDefaults.IMAGE_GENERATING).toEqual(["Cabi is generating your image…"]);
  });

  it("keeps memory, wallet, profile, and storage wording subtle and honest", () => {
    expect(cabiStatusDefaults.MEMORY_LOADING.join(" ")).toContain("Let me remember...");
    const wallet = cabiStatusDefaults.WALLET_VERIFYING.join(" ").toLowerCase();
    expect(wallet).toContain("checking your wallet...");
    // Nothing about wallet wording may imply key access.
    expect(wallet).not.toMatch(/private key|seed phrase|password|secret key/);
    expect(cabiStatusDefaults.PROFILE_SAVING.join(" ")).toContain("Saving that...");
    expect(cabiStatusDefaults.IMAGE_SAVING.join(" ")).toContain("Saving your Cabi image...");
  });
});

describe("owner overrides", () => {
  it("appends custom lines without removing the defaults", () => {
    const messages = resolveStatusMessages("CHAT_THINKING", { CHAT_THINKING: ["Booting my little brain..."] });
    expect(messages).toContain("Booting my little brain...");
    expect(messages).toContain("Cabi is thinking…");
    expect(messages.length).toBe(cabiStatusDefaults.CHAT_THINKING.length + 1);
  });

  it("cannot empty a category", () => {
    // A category always has something to say, whatever the configuration says.
    for (const type of cabiStatusTypes) {
      expect(resolveStatusMessages(type, { [type]: [] }).length).toBeGreaterThan(0);
      expect(resolveStatusMessages(type, { [type]: ["   ", ""] }).length).toBe(cabiStatusDefaults[type].length);
      expect(resolveStatusMessages(type, null).length).toBe(cabiStatusDefaults[type].length);
    }
  });

  it("drops an over-long custom line rather than shipping it", () => {
    const messages = resolveStatusMessages("CHAT_THINKING", { CHAT_THINKING: ["x".repeat(200)] });
    expect(messages).not.toContain("x".repeat(200));
  });
});

describe("rotation timing", () => {
  it("shows the first line immediately", () => {
    expect(nextRotationDelayMs(0)).toBe(0);
  });

  it("waits 2.5-4s before the second line, then 3-5s", () => {
    // Run the ranges rather than a single sample, because the delay is varied.
    for (let index = 0; index < 50; index += 1) {
      const second = nextRotationDelayMs(1);
      expect(second).toBeGreaterThanOrEqual(cabiStatusTiming.secondDelayMinMs);
      expect(second).toBeLessThanOrEqual(cabiStatusTiming.secondDelayMaxMs);
      const steady = nextRotationDelayMs(4);
      expect(steady).toBeGreaterThanOrEqual(cabiStatusTiming.steadyDelayMinMs);
      expect(steady).toBeLessThanOrEqual(cabiStatusTiming.steadyDelayMaxMs);
    }
  });

  it("never rotates faster than the recommended floor", () => {
    // 500ms rotation is exactly what the brief forbids; nothing may schedule below
    // the documented minimum.
    expect(cabiStatusTiming.secondDelayMinMs).toBeGreaterThanOrEqual(2_500);
    expect(cabiStatusTiming.steadyDelayMinMs).toBeGreaterThanOrEqual(3_000);
    for (let index = 1; index < 10; index += 1) {
      expect(nextRotationDelayMs(index)).toBeGreaterThanOrEqual(2_500);
    }
  });

  it("varies the cadence instead of ticking mechanically", () => {
    const samples = new Set<number>();
    for (let index = 0; index < 40; index += 1) samples.add(nextRotationDelayMs(3));
    expect(samples.size).toBeGreaterThan(1);
  });

  it("reports the documented escalation thresholds", () => {
    expect(cabiStatusTiming.patientAfterMs).toBe(15_000);
    expect(cabiStatusTiming.extendedAfterMs).toBe(30_000);
  });
});

describe("message selection", () => {
  it("picks a different line from the one on screen", () => {
    const messages = ["a", "b", "c"];
    for (let index = 0; index < 30; index += 1) {
      expect(pickNextMessage(messages, "a")).not.toBe("a");
    }
  });

  it("starts somewhere in the list when nothing is shown yet", () => {
    const messages = ["a", "b", "c"];
    const seen = new Set(Array.from({ length: 40 }, () => pickNextMessage(messages, null)));
    expect(seen.size).toBeGreaterThan(1);
    for (const value of seen) expect(messages).toContain(value);
  });

  it("returns the only line rather than looping forever", () => {
    expect(pickNextMessage(["solo"], "solo")).toBe("solo");
    expect(pickNextMessage([], "anything")).toBe("");
  });
});

describe("long generations", () => {
  it("escalates on elapsed time, not on a fabricated percentage", () => {
    expect(escalatedMessage(0)).toBeNull();
    expect(escalatedMessage(5_000)).toBeNull();
    expect(escalatedMessage(14_999)).toBeNull();
    expect(escalatedMessage(15_000)).toBe(cabiLongWait.patient);
    expect(escalatedMessage(29_999)).toBe(cabiLongWait.patient);
    expect(escalatedMessage(30_000)).toBe(cabiLongWait.extended);
    expect(escalatedMessage(120_000)).toBe(cabiLongWait.extended);
  });

  it("uses the exact lines the brief specifies", () => {
    expect(cabiLongWait.patient).toBe("Still working on it...");
    expect(cabiLongWait.extended).toBe("This one's taking a little longer.");
  });

  it("never implies failure", () => {
    const wait = `${cabiLongWait.patient} ${cabiLongWait.extended}`.toLowerCase();
    expect(wait).not.toMatch(/fail|error|wrong|broken|gave up/);
  });
});

describe("no fake progress anywhere", () => {
  it("has no percentage in any message", () => {
    const all = [
      ...cabiStatusTypes.flatMap((type) => cabiStatusDefaults[type]),
      ...Object.values(cabiLongWait),
      ...Object.values(cabiFailureMessages),
      ...Object.values(cabiStatusAnnouncements),
    ].join(" ");
    expect(all).not.toMatch(/\b\d{1,3}\s?%/u);
    expect(all).not.toMatch(/\bpercent\b/iu);
  });
});

describe("failure lines", () => {
  it("matches the product wording for each failure", () => {
    expect(cabiFailureMessages.CHAT).toBe("My brain tripped for a second.");
    expect(cabiFailureMessages.IMAGE).toBe("That one didn't come out. Want me to try again?");
    expect(cabiFailureMessages.WALLET).toBe("I couldn't verify that wallet.");
    expect(cabiFailureMessages.MEMORY).toBe("I couldn't pull that memory right now.");
    expect(cabiRetryLabel).toBe("Try Again");
  });

  it("never leaks a technical detail", () => {
    for (const line of Object.values(cabiFailureMessages)) {
      expect(line).not.toMatch(/stack|trace|undefined|null|500|exception|Error:/u);
    }
  });
});

describe("accessibility announcements", () => {
  it("has one stable sentence per activity", () => {
    for (const type of cabiStatusTypes) {
      const announcement = cabiStatusAnnouncements[type as CabiStatusType];
      expect(announcement.length).toBeGreaterThan(10);
      // A single calm statement, not a rotating list.
      expect(announcement).not.toContain("...");
    }
  });

  it("announces the activity rather than the specific rotating line", () => {
    expect(cabiStatusAnnouncements.CHAT_THINKING).toBe("Cabi is processing your request.");
    expect(cabiStatusAnnouncements.IMAGE_GENERATING).toBe("Cabi is generating an image.");
    expect(cabiStatusAnnouncements.WALLET_VERIFYING).toBe("Cabi is verifying your wallet.");
    expect(cabiStatusAnnouncements.MEMORY_LOADING).toBe("Cabi is checking her memories.");
  });
});
