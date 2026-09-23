import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Mode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";
  const mode = (value: Mode) => ({ mode: value, source: "database" as const, override: false });
  return {
    siteMode: vi.fn(async () => mode("PRELAUNCH")),
    adminSession: vi.fn(async (): Promise<{ email: string } | null> => null),
    previewActive: vi.fn(async () => false),
    mode,
  };
});

vi.mock("@/lib/site/mode", () => ({
  getSiteMode: mocks.siteMode,
  siteModeAllowsApp: (mode: string) => mode === "LIVE",
}));
vi.mock("@/lib/security/session", () => ({ readAdminSession: mocks.adminSession }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: mocks.previewActive }));

import { getAppAccess, guardAppApi } from "@/lib/site/guard";

/**
 * PRELAUNCH is not only visual. These tests cover the authorization decision
 * itself: what a visitor, a signed-in admin, and an opted-in admin each get.
 */
describe("server-side app access", () => {
  beforeEach(() => {
    mocks.siteMode.mockReset();
    mocks.adminSession.mockReset();
    mocks.previewActive.mockReset();
    mocks.siteMode.mockResolvedValue(mocks.mode("PRELAUNCH"));
    mocks.adminSession.mockResolvedValue(null);
    mocks.previewActive.mockResolvedValue(false);
  });

  it("lets everyone in while the site is LIVE", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    const access = await getAppAccess();
    expect(access).toEqual({ allowed: true, viewer: "visitor", live: true, previewing: false });
    expect(await guardAppApi()).toBeNull();
    // The public path must not touch admin cookies at all.
    expect(mocks.adminSession).not.toHaveBeenCalled();
    expect(mocks.previewActive).not.toHaveBeenCalled();
  });

  it("blocks an anonymous visitor during PRELAUNCH", async () => {
    const access = await getAppAccess();
    expect(access.allowed).toBe(false);
    expect(access.viewer).toBe("visitor");
  });

  it("blocks a plain admin session that never opted into preview", async () => {
    mocks.adminSession.mockResolvedValue({ email: "owner@cabi.test" });
    const access = await getAppAccess();
    expect(access.allowed).toBe(false);
    expect(access.viewer).toBe("admin");
    expect(access.previewing).toBe(false);
  });

  it("allows an admin with an active preview opt-in", async () => {
    mocks.adminSession.mockResolvedValue({ email: "owner@cabi.test" });
    mocks.previewActive.mockResolvedValue(true);
    const access = await getAppAccess();
    expect(access).toEqual({ allowed: true, viewer: "preview", live: false, previewing: true });
    expect(await guardAppApi()).toBeNull();
  });

  it("still blocks during MAINTENANCE without a preview", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("MAINTENANCE"));
    mocks.adminSession.mockResolvedValue({ email: "owner@cabi.test" });
    expect((await getAppAccess()).allowed).toBe(false);
  });

  it("returns a 404 that does not reveal the endpoint exists", async () => {
    const response = await guardAppApi();
    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
    const payload = await response!.json() as { code?: string };
    expect(payload.code).toBe("SITE_PRELAUNCH");
    expect(response!.headers.get("Cache-Control")).toContain("no-store");
  });

  it("fails closed if reading the preview cookie throws", async () => {
    mocks.adminSession.mockResolvedValue({ email: "owner@cabi.test" });
    mocks.previewActive.mockRejectedValue(new Error("cookie store unavailable"));
    expect((await getAppAccess()).allowed).toBe(false);
  });
});
