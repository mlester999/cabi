import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Mode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";
  const mode = (value: Mode) => ({ mode: value, source: "database" as const, override: false });
  return {
    siteMode: vi.fn(async () => mode("PRELAUNCH")),
    adminSession: vi.fn(async (): Promise<{ email: string } | null> => null),
    previewActive: vi.fn(async () => false),
    // Annotated as unknown: individual tests resolve this to an object, and an
    // inferred `Promise<null>` would reject those assignments.
    ownerPreview: vi.fn(async (): Promise<unknown> => null),
    wallet: vi.fn(async (): Promise<unknown> => null),
    mode,
  };
});

vi.mock("@/lib/site/mode", () => ({
  getSiteMode: mocks.siteMode,
  siteModeAllowsApp: (mode: string) => mode === "LIVE",
}));
vi.mock("@/lib/security/session", () => ({ readAdminSession: mocks.adminSession }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: mocks.previewActive }));
vi.mock("@/lib/site/owner-preview", () => ({ readOwnerPreviewAuth: mocks.ownerPreview }));
vi.mock("@/lib/wallet/session", () => ({ readWalletAuth: mocks.wallet }));

// Only the holder-gate resolution is stubbed, and it keeps the real function's
// short-circuits: outside LIVE the answer is PRELAUNCH, and with no session it is
// NOT_AUTHENTICATED - in both cases without any onchain read. Everything that
// decides *when* the gate runs (site mode first, prelaunch preview, then the
// holder gate) is the real code.
const gate = vi.hoisted(() => ({
  resolve: vi.fn(),
  settings: { minimumBalance: 1_000_000, gateEnabled: true, allowAdminBypass: true },
}));

vi.mock("@/lib/cpu-access/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cpu-access/resolve")>();
  return {
    ...actual,
    resolveCabiAccessForSession: async (session: unknown, options: { mode: string; fresh?: boolean }) => {
      if (options.mode !== "LIVE") {
        return { allowed: false, reason: "PRELAUNCH", live: false, previewing: false, viewer: "visitor", cpuGateBypassed: false, settings: gate.settings };
      }
      if (!session) {
        return { allowed: false, reason: "NOT_AUTHENTICATED", live: true, previewing: false, viewer: "visitor", cpuGateBypassed: false, settings: gate.settings };
      }
      return { ...(await gate.resolve(session)) as object, settings: gate.settings };
    },
  };
});

import { getAppAccess, guardAppApi, guardAppApiCpu } from "@/lib/site/guard";

const walletA = { walletAddress: "0x00000000000000000000000000000000000000A1", walletAddressUniqueKey: "0x00000000000000000000000000000000000000a1" };

function allowed(reason: "ALLOWED" | "ADMIN_BYPASS" = "ALLOWED") {
  return { allowed: true, reason, live: true, previewing: false, viewer: "visitor", cpuGateBypassed: reason === "ADMIN_BYPASS" };
}

function blocked(reason: "INSUFFICIENT_CPU" | "CPU_CHECK_FAILED", walletAddress = walletA.walletAddress) {
  return {
    allowed: false,
    reason,
    live: true,
    previewing: false,
    viewer: "visitor",
    cpuGateBypassed: false,
    gate: {
      reason,
      walletAddress,
      numbers: reason === "INSUFFICIENT_CPU"
        ? { symbol: "CPU", decimals: 18, balance: "225,000", balanceTruncated: false, required: "1,000,000", deficit: "775,000" }
        : null,
      buyUrl: "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528",
      message: reason === "INSUFFICIENT_CPU" ? "You need 1,000,000 $CPU to enter." : "Cabi couldn't verify your $CPU balance right now.",
    },
  };
}

/**
 * PRELAUNCH, LIVE, and the $CPU holder gate are three different questions. These
 * tests cover the decision itself, including the order it is asked in.
 */
describe("server-side app access", () => {
  beforeEach(() => {
    mocks.siteMode.mockReset();
    mocks.adminSession.mockReset();
    mocks.previewActive.mockReset();
    mocks.ownerPreview.mockReset();
    mocks.wallet.mockReset();
    gate.resolve.mockReset();
    mocks.siteMode.mockResolvedValue(mocks.mode("PRELAUNCH"));
    mocks.adminSession.mockResolvedValue(null);
    mocks.previewActive.mockResolvedValue(false);
    mocks.ownerPreview.mockResolvedValue(null);
    mocks.wallet.mockResolvedValue(null);
    gate.resolve.mockResolvedValue(allowed());
  });

  it("requires wallet authentication while the site is LIVE", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    const access = await getAppAccess();
    expect(access.allowed).toBe(false);
    expect(access.decision.reason).toBe("NOT_AUTHENTICATED");
    const response = await guardAppApi();
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    expect((await response!.json() as { code?: string }).code).toBe("WALLET_UNAUTHORIZED");
    // No wallet session means no onchain read at all.
    expect(gate.resolve).not.toHaveBeenCalled();
    // The public path must not touch admin cookies at all.
    expect(mocks.adminSession).not.toHaveBeenCalled();
    expect(mocks.previewActive).not.toHaveBeenCalled();
    expect(mocks.ownerPreview).not.toHaveBeenCalled();
  });

  it("allows a LIVE wallet that meets the $CPU requirement", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    mocks.wallet.mockResolvedValue(walletA);
    const access = await getAppAccess();
    expect(access.allowed).toBe(true);
    expect(access.cpuGateBypassed).toBe(false);
    expect(await guardAppApi()).toBeNull();
    expect(gate.resolve).toHaveBeenCalledWith(walletA);
  });

  it("refuses a LIVE wallet below the requirement with a 403 and the gate detail", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    mocks.wallet.mockResolvedValue(walletA);
    gate.resolve.mockResolvedValue(blocked("INSUFFICIENT_CPU"));
    const response = await guardAppApi();
    expect(response!.status).toBe(403);
    const payload = await response!.json() as { code?: string; cpuGate?: { numbers?: { deficit?: string } } };
    expect(payload.code).toBe("INSUFFICIENT_CPU");
    expect(payload.cpuGate?.numbers?.deficit).toBe("775,000");
    expect(response!.headers.get("Cache-Control")).toContain("no-store");
  });

  it("fails closed with its own code when the balance cannot be verified", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    mocks.wallet.mockResolvedValue(walletA);
    gate.resolve.mockResolvedValue(blocked("CPU_CHECK_FAILED"));
    const response = await guardAppApi();
    expect(response!.status).toBe(403);
    const payload = await response!.json() as { code?: string; error?: string };
    expect(payload.code).toBe("CPU_CHECK_FAILED");
    expect(payload.error).toBe("Cabi couldn't verify your $CPU balance right now.");
  });

  it("lets an approved admin wallet through with cpuGateBypassed", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    mocks.wallet.mockResolvedValue(walletA);
    gate.resolve.mockResolvedValue(allowed("ADMIN_BYPASS"));
    const access = await getAppAccess();
    expect(access.allowed).toBe(true);
    expect(access.cpuGateBypassed).toBe(true);
    expect(await guardAppApi()).toBeNull();
  });

  it("blocks an anonymous visitor during PRELAUNCH without evaluating the gate", async () => {
    const access = await getAppAccess();
    expect(access.allowed).toBe(false);
    expect(access.viewer).toBe("visitor");
    expect(access.decision.reason).toBe("PRELAUNCH");
    // A $CPU balance must never be consulted while the site is not LIVE.
    expect(gate.resolve).not.toHaveBeenCalled();
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
    expect(access).toMatchObject({ allowed: true, viewer: "preview", live: false, previewing: true, cpuGateBypassed: false });
    expect(await guardAppApi()).toBeNull();
    expect(gate.resolve).not.toHaveBeenCalled();
  });

  it("allows a verified, authorized owner wallet during PRELAUNCH without changing the site mode", async () => {
    mocks.ownerPreview.mockResolvedValue({ walletAccountId: "owner-wallet" });
    expect(await getAppAccess()).toMatchObject({ allowed: true, viewer: "preview", previewing: true });
    expect(await guardAppApi()).toBeNull();
    expect(mocks.siteMode).toHaveBeenCalled();
  });

  it("never lets a qualifying $CPU holder bypass PRELAUNCH", async () => {
    // A holder is still just a visitor while the site is not LIVE: the gate is
    // not consulted and the answer stays PRELAUNCH.
    mocks.wallet.mockResolvedValue(walletA);
    gate.resolve.mockResolvedValue(allowed());
    const response = await guardAppApi();
    expect(response!.status).toBe(404);
    const payload = await response!.json() as { code?: string };
    expect(payload.code).toBe("SITE_PRELAUNCH");
    expect(gate.resolve).not.toHaveBeenCalled();
  });

  it("ignores forged client state and query parameters", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    vi.stubGlobal("location", { search: "?preview=true&isAdmin=true&cpu=999999999999" });
    const response = await guardAppApi();
    expect(response?.status).toBe(404);
    expect(mocks.ownerPreview).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not evaluate the gate for the CPU-aware guard during PRELAUNCH", async () => {
    expect(await guardAppApiCpu()).not.toBeNull();
    expect(gate.resolve).not.toHaveBeenCalled();
  });

  it("applies the gate through the CPU-aware guard while LIVE", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
    mocks.wallet.mockResolvedValue(walletA);
    gate.resolve.mockResolvedValue(blocked("INSUFFICIENT_CPU"));
    const response = await guardAppApiCpu();
    expect(response!.status).toBe(403);
  });

  it("still blocks during MAINTENANCE without a preview", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("MAINTENANCE"));
    mocks.adminSession.mockResolvedValue({ email: "owner@cabi.test" });
    expect((await getAppAccess()).allowed).toBe(false);
  });

  it("does not turn the prelaunch wallet exception into a maintenance bypass", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("MAINTENANCE"));
    mocks.ownerPreview.mockResolvedValue({ walletAccountId: "owner-wallet" });
    expect((await getAppAccess()).allowed).toBe(false);
    expect(mocks.ownerPreview).not.toHaveBeenCalled();
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
