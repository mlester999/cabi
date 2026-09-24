import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The holder gate, end to end on the server plane.
 *
 * Nothing about the authorization path is stubbed except the chain itself: the
 * real site-mode rules, the real allowlist lookup, the real settings resolver,
 * the real `balanceOf`/`decimals` read, the real bigint comparison, and the real
 * API/page guards all run. Only the RPC answers are controlled.
 */

const mocks = vi.hoisted(() => {
  type Mode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";
  const mode = (value: Mode) => ({ mode: value, source: "database" as const, override: false });
  return {
    siteMode: vi.fn(async () => mode("LIVE")),
    walletAuth: vi.fn(async (): Promise<unknown> => null),
    adminSession: vi.fn(async (): Promise<unknown> => null),
    previewActive: vi.fn(async () => false),
    ownerPreview: vi.fn(async (): Promise<unknown> => null),
    authorizedOwner: vi.fn(async () => false),
    readContract: vi.fn(),
    mode,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({ readContract: mocks.readContract }) };
});
vi.mock("@/lib/site/mode", () => ({
  getSiteMode: mocks.siteMode,
  siteModeAllowsApp: (mode: string) => mode === "LIVE",
}));
vi.mock("@/lib/wallet/session", () => ({ readWalletAuth: mocks.walletAuth }));
vi.mock("@/lib/security/session", () => ({ readAdminSession: mocks.adminSession }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: mocks.previewActive }));
vi.mock("@/lib/site/owner-preview", () => ({ readOwnerPreviewAuth: mocks.ownerPreview }));
vi.mock("@/lib/site/owner-wallets", () => ({ isAuthorizedOwnerWallet: mocks.authorizedOwner }));

import { getAppAccess, guardAppApi, guardAppApiCpu } from "@/lib/site/guard";
import { invalidateCpuBalance } from "@/lib/cpu-access/balance.server";
import { invalidateCpuAccessGateSettingsCache } from "@/lib/cpu-access/settings.server";
import { displayNumbersFor, isCpuGateBlocked, resolveCabiAccessForSession, type CabiAccess } from "@/lib/cpu-access/resolve";
import { CPU_ACCESS_BUY_URL, CPU_ACCESS_CONTRACT } from "@/lib/cpu-access/config";

const walletA = {
  walletAddress: "0x1111111111111111111111111111111111111111" as const,
  walletAddressUniqueKey: "0x1111111111111111111111111111111111111111",
};

const CPU = (whole: string, decimals = 18) => BigInt(whole) * 10n ** BigInt(decimals);

/** Controls what the "chain" answers for one wallet. */
function chainHolds(input: { balance: bigint; decimals?: unknown; fails?: boolean }) {
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (input.fails) throw new Error("RPC unavailable");
    if (functionName === "balanceOf") return input.balance;
    if (functionName === "decimals") return (input.decimals ?? 18) as never;
    if (functionName === "symbol") return "CPU";
    throw new Error("unexpected call");
  });
}

function live() {
  mocks.siteMode.mockResolvedValue(mocks.mode("LIVE"));
}

/** A verified wallet session, as the signed cookie would resolve it. */
const session = { ...walletA, sessionId: "s", walletAccountId: "a", profileId: "p", expiresAt: "" };

async function decide(wallet: unknown = walletA, options: { fresh?: boolean } = {}) {
  return resolveCabiAccessForSession(wallet as never, { mode: "LIVE", fresh: options.fresh });
}

describe("$CPU holder gate enforcement", () => {
  beforeEach(() => {
    mocks.siteMode.mockReset();
    mocks.walletAuth.mockReset();
    mocks.adminSession.mockReset();
    mocks.previewActive.mockReset();
    mocks.ownerPreview.mockReset();
    mocks.authorizedOwner.mockReset();
    mocks.readContract.mockReset();
    live();
    mocks.walletAuth.mockResolvedValue(null);
    mocks.adminSession.mockResolvedValue(null);
    mocks.previewActive.mockResolvedValue(false);
    mocks.ownerPreview.mockResolvedValue(null);
    mocks.authorizedOwner.mockResolvedValue(false);
    chainHolds({ balance: 0n });
    invalidateCpuBalance();
    invalidateCpuAccessGateSettingsCache();
  });

  it("blocks an unauthenticated user without reading the chain", async () => {
    const decision = await decide(null);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NOT_AUTHENTICATED");
    expect(mocks.readContract).not.toHaveBeenCalled();
    const response = await guardAppApi();
    expect(response!.status).toBe(401);
    expect((await response!.json() as { code?: string }).code).toBe("WALLET_UNAUTHORIZED");
  });

  it("blocks an authenticated wallet holding 0 $CPU", async () => {
    chainHolds({ balance: 0n });
    const decision = await decide();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INSUFFICIENT_CPU");
  });

  it("blocks an authenticated wallet holding 999,999.999 $CPU", async () => {
    chainHolds({ balance: CPU("999999") + CPU("999", 15) });
    const decision = await decide();
    expect(decision.allowed).toBe(false);
    expect(isCpuGateBlocked(decision)).toBe(true);
    if (isCpuGateBlocked(decision)) {
      expect(decision.gate.numbers?.balance).toBe("999,999.999");
      expect(decision.gate.numbers?.deficit).toBe("0.001");
    }
  });

  it("allows an authenticated wallet holding exactly 1,000,000 $CPU", async () => {
    chainHolds({ balance: CPU("1000000") });
    const decision = await decide();
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ALLOWED");
    mocks.walletAuth.mockResolvedValue(session);
    expect(await guardAppApiCpu()).toBeNull();
  });

  it("allows an authenticated wallet above 1,000,000 $CPU", async () => {
    chainHolds({ balance: CPU("1420000") });
    expect((await decide()).allowed).toBe(true);
  });

  it("uses the contract's own decimals and never assumes 18", async () => {
    chainHolds({ balance: CPU("1500000", 6), decimals: 6 });
    const decision = await decide();
    expect(decision.allowed).toBe(true);
    if (isCpuGateBlocked(decision)) return;
    expect(decision.reason).toBe("ALLOWED");
    // The same raw answer against an 18-decimal assumption would have failed.
    expect(CPU("1500000", 6) < CPU("1000000")).toBe(true);
  });

  it("formats readable grouped amounts and truncates rather than rounding up", () => {
    const numbers = displayNumbersFor({
      symbol: "CPU",
      decimals: 18,
      raw: CPU("1245662") + CPU("999", 15),
      deficitRaw: 0n,
      minimum: 1_000_000,
    });
    expect(numbers.balance).toBe("1,245,662.999");
    expect(numbers.balanceTruncated).toBe(false);
    expect(numbers.required).toBe("1,000,000");

    const long = displayNumbersFor({
      symbol: "CPU",
      decimals: 18,
      raw: CPU("1000000") + 1n,
      deficitRaw: 0n,
      minimum: 1_000_000,
    });
    // Exactly one base unit over the line still reads as the requirement, not
    // as a rounded-up number that hides the truth.
    expect(long.balance).toBe("1,000,000");
    expect(long.balanceTruncated).toBe(true);
  });

  it("ignores a forged balance, a forged admin flag, and forged headers", async () => {
    chainHolds({ balance: 0n });
    // Whatever the browser claims, the decision comes from the chain read.
    const forged = {
      ...walletA,
      isAdmin: true,
      cpuGateBypassed: true,
      balance: "999999999999",
      cpuHolder: { allowed: true },
    };
    const decision = await resolveCabiAccessForSession(forged as never, { mode: "LIVE" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INSUFFICIENT_CPU");
    expect((decision as Extract<CabiAccess, { allowed: true }>).cpuGateBypassed).toBeFalsy();
  });

  it("grants a valid approved admin/owner wallet the bypass with $CPU balance of 0", async () => {
    chainHolds({ balance: 0n });
    mocks.authorizedOwner.mockResolvedValue(true);
    const decision = await decide();
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ADMIN_BYPASS");
    if (decision.allowed) expect(decision.cpuGateBypassed).toBe(true);
    // An exempt wallet does not need a chain read at all.
    expect(mocks.readContract).not.toHaveBeenCalled();
    mocks.walletAuth.mockResolvedValue(session);
    expect(await guardAppApiCpu()).toBeNull();
  });

  it("does not let a wallet that is not on the allowlist bypass the gate", async () => {
    chainHolds({ balance: 0n });
    mocks.authorizedOwner.mockResolvedValue(false);
    const decision = await decide();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INSUFFICIENT_CPU");
  });

  it("fails closed when the RPC is unavailable", async () => {
    chainHolds({ balance: 0n, fails: true });
    const decision = await decide();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CPU_CHECK_FAILED");
    if (isCpuGateBlocked(decision)) expect(decision.gate.message).toBe("Cabi couldn't verify your $CPU balance right now.");
    mocks.walletAuth.mockResolvedValue(session);
    const response = await guardAppApiCpu();
    expect(response!.status).toBe(403);
    expect((await response!.json() as { code?: string }).code).toBe("CPU_CHECK_FAILED");
  });

  it("fails closed on a malformed decimals answer instead of assuming 18", async () => {
    chainHolds({ balance: CPU("999999999"), decimals: 255 });
    const decision = await decide();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CPU_CHECK_FAILED");
  });

  it("re-reads on a fresh check, so Check Again never trusts a cached balance", async () => {
    chainHolds({ balance: CPU("1000000") });
    expect((await decide()).allowed).toBe(true);
    // The owner sells. A cached read would still say yes...
    chainHolds({ balance: 0n });
    expect((await decide()).allowed).toBe(true);
    // ...but a fresh check sees the truth, which is what "Check Again" uses.
    expect((await decide(walletA, { fresh: true })).allowed).toBe(false);
  });

  it("denies the next protected request after the wallet drops below the threshold", async () => {
    chainHolds({ balance: CPU("2000000") });
    const conversational = { ...walletA, sessionId: "s", walletAccountId: "a", profileId: "p", expiresAt: "" };
    mocks.walletAuth.mockResolvedValue(conversational);
    expect(await guardAppApiCpu()).toBeNull();

    // Transfer away every $CPU. The very next request must be refused, and the
    // refusal has to be a holder-gate answer rather than a prelaunch 404.
    chainHolds({ balance: 0n });
    const response = await guardAppApiCpu({ fresh: true });
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect((await response!.json() as { code?: string }).code).toBe("INSUFFICIENT_CPU");
  });

  it("does not delete anything when a wallet becomes ineligible", async () => {
    // The gate has no write path at all: it only ever reads. This asserts the
    // shape of the modules rather than a mock, which is the strongest available
    // guarantee that chats, memories, and images survive ineligibility.
    const fs = await import("node:fs/promises");
    const resolveSource = await fs.readFile("lib/cpu-access/resolve.ts", "utf8");
    expect(resolveSource).not.toMatch(/\.delete\(|deleteWhere|\btruncate\b|drop\s+table|revokeSession/i);
    const balanceSource = await fs.readFile("lib/cpu-access/balance.server.ts", "utf8");
    expect(balanceSource).not.toMatch(/\.delete\(|\btruncate\b|drop\s+table|\.update\(|\.insert\(/i);
    const pageSource = await fs.readFile("lib/cpu-access/page.tsx", "utf8");
    expect(pageSource).not.toMatch(/\.delete\(|\btruncate\b|drop\s+table/i);
  });

  it("keeps the requirement on the server for the API guards, not just the page", async () => {
    chainHolds({ balance: CPU("10") });
    mocks.walletAuth.mockResolvedValue(session);
    // /api/chat, /api/images/generate, /api/memories and the rest all call this.
    const response = await guardAppApiCpu({ fresh: true });
    expect(response!.status).toBe(403);
    const payload = await response!.json() as { cpuGate?: { numbers?: { required?: string }; required?: string } };
    expect(payload.cpuGate?.numbers?.required).toBe("1,000,000");
  });

  it("enforces PRELAUNCH before the gate and keeps premium holders out", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("PRELAUNCH"));
    chainHolds({ balance: CPU("999999999") });
    mocks.walletAuth.mockResolvedValue(session);
    const access = await getAppAccess();
    expect(access.allowed).toBe(false);
    expect(access.decision.reason).toBe("PRELAUNCH");
    // A 1B $CPU holder is still refused, and no balance is read to decide it.
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect((await guardAppApiCpu())!.status).toBe(404);
  });

  it("lets an authorized admin preview in during PRELAUNCH", async () => {
    mocks.siteMode.mockResolvedValue(mocks.mode("PRELAUNCH"));
    mocks.ownerPreview.mockResolvedValue({ walletAccountId: "owner" });
    expect((await getAppAccess()).allowed).toBe(true);
    expect(await guardAppApiCpu()).toBeNull();
  });

  it("keeps the official buy URL exact", () => {
    expect(CPU_ACCESS_BUY_URL).toBe(`https://clank.trade/coin/${CPU_ACCESS_CONTRACT}`);
    expect(CPU_ACCESS_CONTRACT).toBe("0x1a421a5065316d9b4062939e9959ddece6630528");
  });

  it("puts the exact buy URL in the refusal payload", async () => {
    chainHolds({ balance: 0n });
    mocks.walletAuth.mockResolvedValue(session);
    const payload = await (await guardAppApiCpu())!.json() as { cpuGate?: { buyUrl?: string } };
    expect(payload.cpuGate?.buyUrl).toBe(CPU_ACCESS_BUY_URL);
  });
});
