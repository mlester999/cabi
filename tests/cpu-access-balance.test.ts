import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The $CPU balance read is the only place access is actually decided, so it is
 * tested directly: against a controlled `readContract` double, with every
 * failure mode exercised.
 */

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mocks.readContract }),
  };
});

import { meetsCpuMinimum, readCpuAccessBalance, requiredFor, invalidateCpuBalance } from "@/lib/cpu-access/balance.server";
import { CPU_ACCESS_CONTRACT } from "@/lib/cpu-access/config";

const wallet = "0x1111111111111111111111111111111111111111";
const config = {
  contract: CPU_ACCESS_CONTRACT,
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  minimum: 1_000_000,
  fallbackSymbol: "CPU",
};

/** Answers balanceOf / decimals / symbol for one wallet. */
function contractAnswers(input: { balance: bigint; decimals?: unknown; symbol?: unknown; fails?: boolean }) {
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (input.fails) throw new Error("RPC down");
    if (functionName === "balanceOf") return input.balance;
    if (functionName === "decimals") {
      if (input.decimals === undefined) throw new Error("no decimals");
      return input.decimals;
    }
    if (functionName === "symbol") {
      if (input.symbol === undefined) throw new Error("no symbol");
      return input.symbol;
    }
    throw new Error(`unexpected ${functionName}`);
  });
}

const cpu = (whole: string, decimals = 18n) => BigInt(whole) * 10n ** decimals;

describe("$CPU access balance", () => {
  beforeEach(() => {
    mocks.readContract.mockReset();
    invalidateCpuBalance();
  });

  it("allows a wallet holding exactly the requirement", async () => {
    contractAnswers({ balance: cpu("1000000"), decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meetsMinimum).toBe(true);
    expect(result.data.deficitRaw).toBe(0n);
    expect(result.data.requiredRaw).toBe(10n ** 24n);
    expect(result.data.decimals).toBe(18);
    expect(result.data.symbol).toBe("CPU");
  });

  it("refuses one base unit below the requirement", async () => {
    contractAnswers({ balance: cpu("1000000") - 1n, decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One wei short is short. This is the case a floating-point comparison
    // silently gets wrong.
    expect(result.data.meetsMinimum).toBe(false);
    expect(result.data.deficitRaw).toBe(1n);
  });

  it("refuses a wallet holding 999,999.999 $CPU", async () => {
    contractAnswers({ balance: cpu("999999") + cpu("999", 15n), decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meetsMinimum).toBe(false);
    expect(result.data.deficitRaw).toBe(10n ** 15n);
  });

  it("allows a wallet above the requirement", async () => {
    contractAnswers({ balance: cpu("1420000"), decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meetsMinimum).toBe(true);
  });

  it("refuses a wallet holding nothing", async () => {
    contractAnswers({ balance: 0n, decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meetsMinimum).toBe(false);
    expect(result.data.deficitRaw).toBe(10n ** 24n);
  });

  it("scales the requirement by the decimals the contract reports", async () => {
    // 6 decimals: 1,000,000 $CPU is 1e12 raw, not 1e24. Assuming 18 would
    // wrongly refuse this holder.
    contractAnswers({ balance: 1_000_000_000_000n, decimals: 6, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decimals).toBe(6);
    expect(result.data.requiredRaw).toBe(1_000_000_000_000n);
    expect(result.data.meetsMinimum).toBe(true);
  });

  it("fails closed when the contract reports absurd decimals", async () => {
    for (const decimals of [255, -1, 1.5, "eighteen", null]) {
      invalidateCpuBalance();
      contractAnswers({ balance: cpu("999999999"), decimals, symbol: "CPU" });
      const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("CPU_CHECK_FAILED");
    }
  });

  it("fails closed when the RPC is unavailable", async () => {
    contractAnswers({ balance: 0n, fails: true });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("couldn't reach");
  });

  it("fails closed on a malformed contract response", async () => {
    contractAnswers({ balance: undefined as unknown as bigint, decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(false);
  });

  it("fails closed when no chain is configured", async () => {
    contractAnswers({ balance: cpu("2000000"), decimals: 18, symbol: "CPU" });
    const result = await readCpuAccessBalance({ address: wallet, config: { ...config, rpcUrl: "" }, fresh: true });
    expect(result.ok).toBe(false);
  });

  it("fails closed for an invalid contract, an invalid wallet, or a nonsense minimum", async () => {
    contractAnswers({ balance: cpu("2000000"), decimals: 18, symbol: "CPU" });
    expect((await readCpuAccessBalance({ address: wallet, config: { ...config, contract: "0xnot-an-address" }, fresh: true })).ok).toBe(false);
    expect((await readCpuAccessBalance({ address: "not-a-wallet", config, fresh: true })).ok).toBe(false);
    expect((await readCpuAccessBalance({ address: wallet, config: { ...config, minimum: 0 }, fresh: true })).ok).toBe(false);
  });

  it("falls back to the configured ticker when symbol() is unavailable", async () => {
    contractAnswers({ balance: cpu("2000000"), decimals: 18 });
    const result = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.symbol).toBe("CPU");
  });

  it("serves a cached read unless a fresh one is demanded", async () => {
    contractAnswers({ balance: cpu("1000000"), decimals: 18, symbol: "CPU" });
    await readCpuAccessBalance({ address: wallet, config });
    // Changing what the chain would answer must not change a cached answer.
    contractAnswers({ balance: 0n, decimals: 18, symbol: "CPU" });
    const cached = await readCpuAccessBalance({ address: wallet, config });
    expect(cached.ok).toBe(true);
    if (!cached.ok) return;
    expect(cached.data.cached).toBe(true);
    expect(cached.data.meetsMinimum).toBe(true);

    // "Check Again" bypasses the cache and sees the new balance.
    const fresh = await readCpuAccessBalance({ address: wallet, config, fresh: true });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.data.cached).toBe(false);
    expect(fresh.data.meetsMinimum).toBe(false);
  });

  it("is a pure integer comparison at the boundary", () => {
    expect(meetsCpuMinimum(requiredFor(1_000_000, 18), 1_000_000, 18)).toBe(true);
    expect(meetsCpuMinimum(requiredFor(1_000_000, 18) - 1n, 1_000_000, 18)).toBe(false);
    expect(meetsCpuMinimum(requiredFor(1_000_000, 6), 1_000_000, 6)).toBe(true);
    // A 6-decimal contract compared against 18-decimal assumptions still fails.
    expect(meetsCpuMinimum(requiredFor(1_000_000, 6), 1_000_000, 18)).toBe(false);
  });
});
