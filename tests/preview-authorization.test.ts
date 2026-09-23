import { describe, expect, it } from "vitest";

import { validatePreviewToken } from "@/lib/site/preview-rules";

/**
 * The preview cookie is what unlocks the unfinished application for the owner.
 * These tests pin its authorization rules: correct scope, correct admin, and an
 * unexpired window. Anything else must fail closed.
 */
describe("admin preview token authorization", () => {
  const adminEmail = "owner@cabi.test";
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const base = { scope: "preview", email: adminEmail, expiresAt: now + 60_000 };

  it("accepts a correctly scoped, unexpired token for the configured admin", () => {
    expect(validatePreviewToken(base, adminEmail, now)).toEqual({ email: adminEmail, expiresAt: base.expiresAt });
  });

  it("is case-insensitive about the admin email", () => {
    expect(validatePreviewToken({ ...base, email: "OWNER@CABI.TEST" }, adminEmail, now)).not.toBeNull();
  });

  it("rejects an expired preview", () => {
    expect(validatePreviewToken({ ...base, expiresAt: now - 1 }, adminEmail, now)).toBeNull();
  });

  it("rejects a token minted for a different admin", () => {
    expect(validatePreviewToken({ ...base, email: "someone@else.test" }, adminEmail, now)).toBeNull();
  });

  it("rejects a token with the wrong scope", () => {
    expect(validatePreviewToken({ ...base, scope: "guest" }, adminEmail, now)).toBeNull();
    expect(validatePreviewToken({ ...base, scope: "admin" }, adminEmail, now)).toBeNull();
    expect(validatePreviewToken({ ...base, scope: undefined }, adminEmail, now)).toBeNull();
  });

  it("fails closed when no admin is configured", () => {
    expect(validatePreviewToken(base, undefined, now)).toBeNull();
    expect(validatePreviewToken(base, "", now)).toBeNull();
  });

  it("rejects malformed payloads", () => {
    for (const value of [null, undefined, "preview", 42, [], {}, { ...base, email: 1 }, { ...base, expiresAt: "soon" }, { ...base, expiresAt: Number.NaN }]) {
      expect(validatePreviewToken(value, adminEmail, now)).toBeNull();
    }
  });
});
