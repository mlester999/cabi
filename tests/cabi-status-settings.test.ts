import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner-added activity messages.
 *
 * The property that matters most: configuration can only ever ADD. A missing row,
 * a malformed row, a disabled switch, or an empty category all resolve to the
 * built-in lines, so the activity indicator can never end up with nothing to say.
 */

const mocks = vi.hoisted(() => ({
  stored: null as unknown,
  error: null as unknown,
  upserted: [] as unknown[],
  deleted: [] as string[],
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table !== "app_settings") {
        const inert: Record<string, unknown> = {};
        inert.select = () => inert;
        inert.eq = () => inert;
        inert.maybeSingle = async () => ({ data: null, error: null });
        return inert;
      }
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({
        data: mocks.stored === null ? null : { value_json: mocks.stored },
        error: mocks.error,
      });
      query.upsert = async (row: unknown) => {
        mocks.upserted.push(row);
        return { error: null };
      };
      query.delete = () => {
        const chain = { eq: async (_column: string, key: string) => { mocks.deleted.push(key); return { error: null }; } };
        return chain;
      };
      return query;
    },
  }),
}));

import {
  cabiStatusMaxPerCategory,
  invalidateCabiStatusMessagesCache,
  parseCabiStatusMessages,
  readActiveStatusOverrides,
  readCabiStatusMessages,
  resetCabiStatusMessages,
  writeCabiStatusMessages,
} from "@/lib/cabi/status-settings.server";
import { cabiStatusDefaults, resolveStatusMessages } from "@/lib/cabi/status-messages";

beforeEach(() => {
  mocks.stored = null;
  mocks.error = null;
  mocks.upserted.length = 0;
  mocks.deleted.length = 0;
  invalidateCabiStatusMessagesCache();
});

describe("parsing stored messages", () => {
  it("keeps only known categories and valid lines", () => {
    const parsed = parseCabiStatusMessages({
      enabled: true,
      custom: {
        CHAT_THINKING: ["Booting my little CPU...", "  ", "x".repeat(200)],
        NOT_A_CATEGORY: ["ignored"],
        IMAGE_GENERATING: ["Striking a pose..."],
      },
    });
    expect(parsed.custom.CHAT_THINKING).toEqual(["Booting my little CPU..."]);
    expect(parsed.custom.IMAGE_GENERATING).toEqual(["Striking a pose..."]);
    expect(Object.keys(parsed.custom)).not.toContain("NOT_A_CATEGORY");
  });

  it("de-duplicates and caps the list per category", () => {
    const many = Array.from({ length: cabiStatusMaxPerCategory + 5 }, (_, index) => `Line ${index}`);
    const parsed = parseCabiStatusMessages({ enabled: true, custom: { CHAT_THINKING: [...many, "Line 0"] } });
    expect(parsed.custom.CHAT_THINKING).toHaveLength(cabiStatusMaxPerCategory);
  });

  it("treats a malformed row as no configuration at all", () => {
    expect(parseCabiStatusMessages({ enabled: "yes", custom: "nonsense" })).toEqual({ enabled: false, custom: {} });
    expect(parseCabiStatusMessages(null)).toEqual({ enabled: false, custom: {} });
  });

  it("defaults to disabled", () => {
    expect(parseCabiStatusMessages({ custom: { CHAT_THINKING: ["Hi"] } }).enabled).toBe(false);
  });
});

describe("no configuration can silence the rotation", () => {
  it("applies nothing when there is no stored row", async () => {
    const settings = await readCabiStatusMessages({ fresh: true });
    expect(settings).toEqual({ enabled: false, custom: {} });
    expect(await readActiveStatusOverrides()).toBeNull();
  });

  it("applies nothing when the switch is off, even with lines saved", async () => {
    mocks.stored = { enabled: false, custom: { CHAT_THINKING: ["Saved but off..."] } };
    expect(await readActiveStatusOverrides()).toBeNull();
  });

  it("applies the lines when the switch is on", async () => {
    mocks.stored = { enabled: true, custom: { CHAT_THINKING: ["Saved and on..."] } };
    expect(await readActiveStatusOverrides()).toEqual({ CHAT_THINKING: ["Saved and on..."] });
  });

  it("fails closed to the built-in lines when the row cannot be read", async () => {
    mocks.error = { message: "boom" };
    mocks.stored = { enabled: true, custom: { CHAT_THINKING: ["unreachable"] } };
    expect(await readActiveStatusOverrides()).toBeNull();
  });

  it("still rotates the built-in lines for a category with no custom entry", () => {
    const overrides = { CHAT_THINKING: ["Only chat has an extra"] };
    for (const type of ["IMAGE_GENERATING", "MEMORY_LOADING", "WALLET_VERIFYING"] as const) {
      const messages = resolveStatusMessages(type, overrides);
      expect(messages.length).toBeGreaterThanOrEqual(cabiStatusDefaults[type].length);
      expect(messages).toEqual([...cabiStatusDefaults[type]]);
    }
  });
});

describe("writing and resetting", () => {
  it("stores only the extras and the switch", async () => {
    const saved = await writeCabiStatusMessages({ enabled: true, custom: { IMAGE_GENERATING: ["Almost there..."] } }, "owner@cabi.test");
    expect(saved.enabled).toBe(true);
    expect(mocks.upserted).toHaveLength(1);
    const row = mocks.upserted[0] as { key: string; value_json: unknown; updated_by: string };
    expect(row.key).toBe("cabi_status_messages");
    expect(row.updated_by).toBe("owner@cabi.test");
    // The built-in lines are never written to the database: they are code.
    expect(JSON.stringify(row.value_json)).not.toContain(cabiStatusDefaults.CHAT_THINKING[0]);
  });

  it("drops invalid input rather than storing it", async () => {
    const saved = await writeCabiStatusMessages({ enabled: true, custom: { CHAT_THINKING: ["", "x".repeat(400)] } }, "owner@cabi.test");
    expect(saved.custom.CHAT_THINKING).toBeUndefined();
  });

  it("resets to nothing configured", async () => {
    mocks.stored = { enabled: true, custom: { CHAT_THINKING: ["x"] } };
    const reset = await resetCabiStatusMessages();
    expect(reset).toEqual({ enabled: false, custom: {} });
    expect(mocks.deleted).toContain("cabi_status_messages");
  });
});
