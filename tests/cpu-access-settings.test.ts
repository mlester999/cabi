import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-side gate settings.
 *
 * The point of these tests is that the holder requirement is an authorization
 * input: it is validated, bounded, and cannot be redirected by a database row,
 * a request body, or a stale cache.
 */

const mocks = vi.hoisted(() => ({
  database: vi.fn((): unknown => null),
  audit: vi.fn(async () => undefined),
  admin: vi.fn(async () => ({ session: { email: "owner@cabi.test" }, response: null })),
  value: null as unknown,
  error: null as unknown,
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceClient: mocks.database }));
vi.mock("@/lib/admin/audit", () => ({ auditAdmin: mocks.audit }));
vi.mock("@/lib/admin/auth", () => ({ adminOrResponse: mocks.admin }));

/** A minimal `app_settings` double that returns one stored row. */
function settingsRow(value: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === null ? null : { value_json: value }, error }) }) }),
      upsert: async (row: { value_json: unknown }) => {
        mocks.value = row.value_json;
        return { error: null };
      },
    }),
  };
}

import {
  boundedMinimumBalance,
  invalidateCpuAccessGateSettingsCache,
  parseCpuAccessGateSettings,
  readCpuAccessGateSettings,
  writeCpuAccessGateSettings,
} from "@/lib/cpu-access/settings.server";
import { CPU_ACCESS_BUY_URL, CPU_ACCESS_CONTRACT, CPU_MIN_ACCESS_BALANCE } from "@/lib/cpu-access/config";

type Gate = Awaited<ReturnType<typeof readCpuAccessGateSettings>>["settings"];

const base: Gate = {
  enabled: true,
  minimumBalance: CPU_MIN_ACCESS_BALANCE,
  contract: CPU_ACCESS_CONTRACT.toUpperCase().replace("0X", "0x"),
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  allowAdminBypass: true,
  buyUrl: CPU_ACCESS_BUY_URL,
};

describe("CPU access gate settings", () => {
  beforeEach(() => {
    mocks.database.mockReset();
    mocks.database.mockReturnValue(null);
    mocks.audit.mockReset();
    mocks.admin.mockReset();
    invalidateCpuAccessGateSettingsCache();
  });

  it("defaults to the official contract, chain, buy URL, and 1,000,000 $CPU", async () => {
    const { settings, source } = await readCpuAccessGateSettings({ fresh: true });
    expect(settings.enabled).toBe(true);
    expect(settings.minimumBalance).toBe(1_000_000);
    expect(settings.allowAdminBypass).toBe(true);
    expect(settings.chainId).toBe(4663);
    expect(settings.contract.toLowerCase()).toBe(CPU_ACCESS_CONTRACT);
    expect(settings.buyUrl).toBe(CPU_ACCESS_BUY_URL);
    expect(source.minimumBalance).toBe("default");
  });

  it("takes a valid saved row from the database", async () => {
    mocks.database.mockReturnValue(settingsRow({ enabled: false, minimumBalance: 2_500_000, allowAdminBypass: false }));
    const { settings, source } = await readCpuAccessGateSettings({ fresh: true });
    expect(settings.enabled).toBe(false);
    expect(settings.minimumBalance).toBe(2_500_000);
    expect(settings.allowAdminBypass).toBe(false);
    expect(source.minimumBalance).toBe("database");
    expect(source.enabled).toBe("database");
  });

  it("refuses to point the gate at another contract, chain, or host", () => {
    const parsed = parseCpuAccessGateSettings({
      contract: "0x000000000000000000000000000000000000dead",
      chainId: 1,
      buyUrl: "https://evil.example/coin/0x000000000000000000000000000000000000dead",
    }, base);
    expect(parsed.contract).toBe(base.contract);
    expect(parsed.chainId).toBe(4663);
    expect(parsed.buyUrl).toBe(CPU_ACCESS_BUY_URL);
  });

  it("keeps the official contract when a row agrees with it", () => {
    const parsed = parseCpuAccessGateSettings({ contract: CPU_ACCESS_CONTRACT.toUpperCase() }, base);
    expect(parsed.contract.toLowerCase()).toBe(CPU_ACCESS_CONTRACT);
  });

  it("rejects out-of-range minimums instead of clamping them", () => {
    for (const minimumBalance of [0, -1, 0.5, "abc", null, 1e13, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(boundedMinimumBalance(minimumBalance)).toBeNull();
      expect(parseCpuAccessGateSettings({ minimumBalance }, base).minimumBalance).toBe(1_000_000);
    }
    expect(boundedMinimumBalance(25)).toBe(25);
    expect(boundedMinimumBalance("2500000")).toBe(2_500_000);
    expect(boundedMinimumBalance(1_500_000.9)).toBe(1_500_000);
  });

  it("fails closed when the settings row cannot be read", async () => {
    mocks.database.mockReturnValue(settingsRow(null, { message: "boom" }));
    const { settings } = await readCpuAccessGateSettings({ fresh: true });
    // An unreadable row must never be interpreted as "gate off".
    expect(settings.enabled).toBe(true);
    expect(settings.minimumBalance).toBe(1_000_000);
  });

  it("never lets a malformed row turn the gate off or lower it", () => {
    const parsed = parseCpuAccessGateSettings({ enabled: "false", minimumBalance: "0", allowAdminBypass: "yes" }, base);
    expect(parsed.enabled).toBe(true);
    expect(parsed.minimumBalance).toBe(1_000_000);
    expect(parsed.allowAdminBypass).toBe(true);
  });

  it("writes only validated values and caches the saved result", async () => {
    mocks.database.mockReturnValue(settingsRow(null));
    const saved = await writeCpuAccessGateSettings({ minimumBalance: 3_000_000, enabled: false, allowAdminBypass: false }, "owner@cabi.test");
    expect(saved.minimumBalance).toBe(3_000_000);
    expect(saved.enabled).toBe(false);
    const { settings } = await readCpuAccessGateSettings();
    expect(settings.minimumBalance).toBe(3_000_000);
  });

  it("refuses an invalid minimum on write", async () => {
    mocks.database.mockReturnValue(settingsRow(null));
    await expect(writeCpuAccessGateSettings({ minimumBalance: 0 }, "owner@cabi.test")).rejects.toThrow("INVALID_MINIMUM_BALANCE");
  });

  it("requires a database before accepting a change", async () => {
    await expect(writeCpuAccessGateSettings({ enabled: false }, "owner@cabi.test")).rejects.toThrow("DATABASE_NOT_CONFIGURED");
  });
});

/**
 * The switch itself.
 */
describe("cpu_holder_gate_enabled feature flag", () => {
  beforeEach(() => {
    mocks.database.mockReset();
    mocks.database.mockReturnValue(null);
    invalidateCpuAccessGateSettingsCache();
  });

  it("lets normal authenticated users in when an owner disables the gate", async () => {
    mocks.database.mockReturnValue(settingsRow({ enabled: false, minimumBalance: 1_000_000, allowAdminBypass: true }));
    const { settings } = await readCpuAccessGateSettings({ fresh: true });
    expect(settings.enabled).toBe(false);

    // The decision then rests on authentication alone, with no chain read.
    const { resolveCabiAccess } = await import("@/lib/cpu-access/resolve");
    const decision = resolveCabiAccess({
      mode: "LIVE",
      session: { walletAddress: "0x1111111111111111111111111111111111111111", walletAddressUniqueKey: "0x1111111111111111111111111111111111111111" },
      gateEnabled: settings.enabled,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ALLOWED");
  });

  it("honours the deployment environment override", async () => {
    vi.stubEnv("CPU_HOLDER_GATE_ENABLED", "false");
    invalidateCpuAccessGateSettingsCache();
    const { settings, source } = await readCpuAccessGateSettings({ fresh: true });
    expect(settings.enabled).toBe(false);
    expect(source.enabled).toBe("environment");
    vi.unstubAllEnvs();
  });
});
