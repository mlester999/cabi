import { describe, expect, it } from "vitest";

import { parseWalletProductConfig } from "@/lib/wallet/config";
import { resolveCabiAccess, type CpuGateNumbers } from "@/lib/cpu-access/resolve";

/**
 * The five worked examples from the product brief, rendered as the modal data.
 *
 * `resolveCabiAccess` is the same function the server uses, so this is not a
 * mock-up of the copy: if these strings are wrong, the real gate is wrong.
 */

const session = {
  walletAddress: "0x123400000000000000000000000000000000ABCD" as const,
  walletAddressUniqueKey: "0x123400000000000000000000000000000000abcd",
};

const balance = (input: { raw: bigint; minimum: number; meetsMinimum: boolean; deficitRaw: bigint }): {
  raw: bigint; decimals: number; symbol: string; contract: string; chainId: number; minimum: number; requiredRaw: bigint; deficitRaw: bigint; meetsMinimum: boolean; cached: boolean;
} => ({
  raw: input.raw,
  decimals: 18,
  symbol: "CPU",
  contract: "0x1a421a5065316d9b4062939e9959ddece6630528",
  chainId: 4663,
  minimum: input.minimum,
  requiredRaw: BigInt(input.minimum) * 10n ** 18n,
  deficitRaw: input.deficitRaw,
  meetsMinimum: input.meetsMinimum,
  cached: false,
});

const CPU = (whole: string) => BigInt(whole) * 10n ** 18n;

function gateFor(held: string, minimum: number) {
  const raw = CPU(held);
  const requiredRaw = BigInt(minimum) * 10n ** 18n;
  const decision = resolveCabiAccess({
    mode: "LIVE",
    session,
    gateEnabled: true,
    balance: balance({ raw, minimum, meetsMinimum: raw >= requiredRaw, deficitRaw: raw >= requiredRaw ? 0n : requiredRaw - raw }),
    walletAddress: session.walletAddress,
    buyUrl: "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528",
  });
  if (decision.allowed) return null;
  if (decision.reason !== "INSUFFICIENT_CPU") return null;
  return decision.gate.numbers as CpuGateNumbers;
}

describe("holder gate copy", () => {
  it("matches Example A: 1,420,000 $CPU is allowed outright", () => {
    expect(gateFor("1420000", 1_000_000)).toBeNull();
  });

  it("matches Example B: 225,000 $CPU shows the balance and the exact shortfall", () => {
    const numbers = gateFor("225000", 1_000_000);
    expect(numbers).not.toBeNull();
    expect(numbers!.required).toBe("1,000,000");
    expect(numbers!.balance).toBe("225,000");
    expect(numbers!.deficit).toBe("775,000");
    expect(numbers!.symbol).toBe("CPU");
  });

  it("matches Example C: an admin wallet needs no balance at all", () => {
    const decision = resolveCabiAccess({ mode: "LIVE", session, gateEnabled: true, isAdmin: true, allowAdminBypass: true });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.cpuGateBypassed).toBe(true);
  });

  it("shows the requirement as a membership number, grouped, never raw base units", () => {
    const numbers = gateFor("742350", 1_000_000);
    expect(numbers!.balance).toBe("742,350");
    expect(numbers!.deficit).toBe("257,650");
    // The raw base-unit value must never reach the display model.
    expect(JSON.stringify(numbers)).not.toContain("742350000000000000000000");
  });

  it("keeps the requirement configurable server-side without changing the copy shape", () => {
    const numbers = gateFor("1000000", 2_500_000);
    expect(numbers!.required).toBe("2,500,000");
    expect(numbers!.deficit).toBe("1,500,000");
  });
});

/**
 * The public configuration projection must keep redacting a staged token page.
 * The holder gate resolves its own trusted configuration, so it does not need -
 * and must not cause - the public JSON to publish an unlaunched destination.
 */
describe("public CPU projection stays redacted", () => {
  it("never publishes a staged contract through redactUnlaunchedCpu", async () => {
    const { redactUnlaunchedCpu } = await import("@/lib/wallet/config");
    const staged = parseWalletProductConfig({
      chains: [{
        id: 4663,
        name: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
        blockExplorerUrl: "https://explorer.robinhood.com",
        iconUrl: "",
        enabled: true,
      }],
      primaryChainId: 4663,
      cpu: {
        tokenName: "Cat Partner Unit",
        ticker: "CPU",
        launchStatus: "PRELAUNCH",
        contractAddress: "0x1a421a5065316d9b4062939e9959ddece6630528",
        chainId: 4663,
        clankTradeUrl: "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528",
        explorerUrl: "",
        xUrl: "",
        websiteUrl: "",
        description: "",
      },
    });
    const projected = redactUnlaunchedCpu(staged);
    expect(projected.cpu.contractAddress).toBe("");
    expect(projected.cpu.clankTradeUrl).toBe("");
    // The gate is unaffected: it resolves the official contract from server-side
    // configuration (`lib/cpu-access/config.ts`), not from this projection.
  });
});
