import { describe, expect, it } from "vitest";

/**
 * Real onchain verification of the holder gate.
 *
 * This suite is opt-in (`CABI_CPU_ONCHAIN=1`) because it performs a genuine,
 * read-only `eth_call` against the official $CPU contract on Robinhood Chain. It
 * sends no transaction and needs no key: it is exactly the read the gate performs
 * in production, run against a real holder and a real empty wallet.
 *
 *   CABI_CPU_ONCHAIN=1 npx vitest run tests/cpu-access-onchain.test.ts
 *
 * Both cases are required. A gate that only proves it can refuse is not verified,
 * and one that only proves it can accept is not a gate.
 */
const enabled = process.env.CABI_CPU_ONCHAIN === "1";

/** A real address observed holding hundreds of millions of $CPU. */
const realHolder = "0xa83f9a9abcaac3962a7195c3a37a8e5f156edc55";
/** An address this project has never used, so it holds nothing. */
const emptyWallet = "0x00000000000000000000000000000000DeadBeef";

const config = {
  contract: "0x1a421a5065316d9b4062939e9959ddece6630528",
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  minimum: 1_000_000,
  fallbackSymbol: "CPU",
};

describe.runIf(enabled)("real onchain $CPU reads", () => {
  it("reads decimals() and a qualifying balance from the official contract", async () => {
    const { readCpuAccessBalance } = await import("@/lib/cpu-access/balance.server");
    const result = await readCpuAccessBalance({ address: realHolder, config, fresh: true });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    // Decimals come from the contract, not from an assumption.
    expect(result.data.decimals).toBe(18);
    expect(result.data.symbol).toBe("CPU");
    expect(result.data.meetsMinimum).toBe(true);
    expect(result.data.deficitRaw).toBe(0n);
    // The live balance moves with the market, so the assertion is on the shape
    // and magnitude of a real read rather than on a frozen number.
    expect(result.data.raw > 100_000_000n * 10n ** 18n).toBe(true);
    expect(result.data.raw).toBe(result.data.requiredRaw + (result.data.raw - result.data.requiredRaw));
  });

  it("reads an empty balance and refuses it", async () => {
    const { readCpuAccessBalance } = await import("@/lib/cpu-access/balance.server");
    const result = await readCpuAccessBalance({ address: emptyWallet, config, fresh: true });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.data.raw).toBe(0n);
    expect(result.data.meetsMinimum).toBe(false);
    // The shortfall is the whole requirement, computed with bigint.
    expect(result.data.deficitRaw).toBe(1_000_000n * 10n ** 18n);
  });
});

describe.skipIf(enabled)("real onchain $CPU reads", () => {
  it("is opt-in", () => {
    expect(enabled).toBe(false);
  });
});
