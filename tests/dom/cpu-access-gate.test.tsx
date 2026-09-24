import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The holder gate as the browser renders it.
 *
 * These assertions are about what a locked-out holder actually sees and can do:
 * the requirement, their own balance, the exact shortfall, a Buy button that
 * opens the official Clank.trade page in a new tab, and a Check Again button that
 * asks the server again. Nothing here can grant access - the component has no
 * authority at all - so the tests also pin that the unlock only follows a server
 * answer.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  openConnect: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  wallet: {
    address: "0x123400000000000000000000000000000000ABCD" as string | null,
    authenticated: true,
    sessionLoaded: true,
    authenticatedAt: 1 as number | null,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: mocks.refresh }),
}));

vi.mock("@/components/wallet/wallet-provider", () => ({
  useWallet: () => ({
    ...mocks.wallet,
    openConnect: mocks.openConnect,
    disconnect: mocks.disconnect,
  }),
}));

import { CpuAccessPanel, CpuHolderGate, CpuSignedOutGate } from "@/components/cpu/cpu-access-gate";
import { CpuAccessStatusMonitor } from "@/components/cpu/cpu-access-status-monitor";

const buyUrl = "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528";

function view(overrides: Partial<Parameters<typeof CpuAccessPanel>[0]["view"]> = {}) {
  return {
    walletAddress: "0x123400000000000000000000000000000000ABCD",
    required: "1,000,000",
    minimumBalance: 1_000_000,
    balance: "225,000",
    deficit: "775,000",
    symbol: "CPU",
    reason: "INSUFFICIENT_CPU" as const,
    message: null,
    buyUrl,
    ...overrides,
  };
}

/** Row values are split across an icon and a description cell, so text is read
 * from the whole panel rather than from a single element. */
function showsText(fragment: string) {
  return (document.body.textContent ?? "").replace(/\s+/gu, " ").includes(fragment);
}

describe("holder gate panel", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.openConnect.mockReset();
    mocks.disconnect.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false })));
  });

  it("shows the requirement, the wallet, the balance, and the exact shortfall", () => {
    render(<CpuAccessPanel view={view()} onCheckAgain={() => undefined} />);
    expect(screen.getByText("Cabi Holder Access")).toBeInTheDocument();
    expect(showsText("1,000,000 $CPU required")).toBe(true);
    expect(showsText("0x1234…ABCD")).toBe(true);
    expect(showsText("225,000 $CPU")).toBe(true);
    expect(showsText("1,000,000 $CPU")).toBe(true);
    expect(showsText("775,000 $CPU")).toBe(true);
  });

  it("uses the recommended, non-pressuring copy", () => {
    render(<CpuAccessPanel view={view()} />);
    expect(showsText("available to holders of at least")).toBe(true);
    expect(showsText("Grab $CPU on Clank.trade, then come back and check your balance again.")).toBe(true);
    expect(screen.getByText("How to get access")).toBeInTheDocument();
    expect(showsText("Buy enough $CPU to reach 1,000,000 $CPU.")).toBe(true);
    // No urgency, no threats, and no fabricated market data.
    expect(document.body.textContent).not.toMatch(/lose access|last chance|only \d+ left|market cap|bonding|24h volume/i);
  });

  it("opens exactly the official Clank.trade page in a new tab", () => {
    render(<CpuAccessPanel view={view()} onBuy={() => undefined} />);
    const buy = screen.getByRole("link", { name: /Open \$CPU on Clank\.trade/ });
    expect(buy).toHaveAttribute("href", buyUrl);
    expect(buy).toHaveAttribute("target", "_blank");
    expect(buy.getAttribute("rel")).toContain("noopener");
    expect(buy.getAttribute("rel")).toContain("noreferrer");
  });

  it("offers Check Again and Disconnect Wallet without ever trading", () => {
    render(<CpuAccessPanel view={view()} onCheckAgain={() => undefined} onDisconnect={() => undefined} />);
    expect(screen.getByRole("button", { name: /Check Again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disconnect Wallet/ })).toBeInTheDocument();
    // The modal never triggers a wallet transaction of its own.
    expect(showsText("never sends a transaction from here")).toBe(true);
  });

  it("shows a checking state while a fresh read is in flight", () => {
    render(<CpuAccessPanel view={view()} checking />);
    expect(screen.getByRole("button", { name: /Checking balance/ })).toBeDisabled();
  });

  it("shows the couldn't-verify variant for a failed read", () => {
    render(<CpuAccessPanel view={view({ reason: "CPU_CHECK_FAILED", balance: null, deficit: null, message: "Cabi couldn't verify your $CPU balance right now." })} onCheckAgain={() => undefined} />);
    expect(showsText("Cabi couldn't verify your $CPU balance right now.")).toBe(true);
    expect(showsText("Couldn't read")).toBe(true);
    // The failure variant offers exactly the two documented actions.
    expect(screen.getByRole("button", { name: /Try Again/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open \$CPU on Clank\.trade/ })).toHaveAttribute("href", buyUrl);
    // No fabricated balance when the chain could not be read.
    expect(showsText("225,000")).toBe(false);
  });

  it("asks a visitor to connect rather than showing numbers", () => {
    render(<CpuAccessPanel signedOut view={view({ walletAddress: null, balance: null, deficit: null })} onConnect={() => undefined} />);
    expect(screen.getByRole("button", { name: /Connect Wallet/ })).toBeInTheDocument();
    expect(showsText("Not connected")).toBe(true);
    expect(showsText("Your balance")).toBe(false);
  });
});

describe("holder gate behaviour", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.disconnect.mockReset();
    mocks.wallet.address = "0x123400000000000000000000000000000000ABCD";
    mocks.wallet.authenticated = true;
    mocks.wallet.authenticatedAt = 1;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "INSUFFICIENT_CPU" })));
  });

  it("updates the numbers after a fresh server check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      allowed: false,
      reason: "INSUFFICIENT_CPU",
      walletAddress: "0x123400000000000000000000000000000000ABCD",
      balance: "900,000",
      deficit: "100,000",
      required: "1,000,000",
      symbol: "CPU",
      buyUrl,
    })));
    render(<CpuHolderGate initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check Again/ }));
    await waitFor(() => expect(showsText("900,000 $CPU")).toBe(true));
    expect(showsText("100,000 $CPU")).toBe(true);
  });

  it("confirms and re-resolves the page only after the server says allowed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/cpu/access")
      ? Response.json({ allowed: true, reason: "ALLOWED" })
      : new Response(null, { status: 204 })));
    render(<CpuHolderGate initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check Again/ }));
    await waitFor(() => expect(showsText("You're in")).toBe(true));
    // The unlock is the server re-rendering the page, not local state.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("never unlocks when the client tries to fake success locally", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "INSUFFICIENT_CPU" })));
    render(<CpuHolderGate initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Check Again/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(showsText("You're in")).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("asks the server for a fresh decision when a protected call was refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "INSUFFICIENT_CPU", balance: "10", deficit: "999,990", required: "1,000,000", symbol: "CPU" })));
    render(<CpuHolderGate initial={view()} />);
    const { announceCpuGateBlocked } = await import("@/lib/cpu-access/events");
    act(() => { announceCpuGateBlocked({ code: "INSUFFICIENT_CPU" }); });
    await waitFor(() => expect(showsText("10 $CPU")).toBe(true));
  });

  it("disconnects the wallet from the gate", () => {
    render(<CpuHolderGate initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Disconnect Wallet/ }));
    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it("re-resolves on the server after a wallet switch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "INSUFFICIENT_CPU", balance: "5", deficit: "999,995", required: "1,000,000", symbol: "CPU" })));
    const rendered = render(<CpuHolderGate initial={view()} />);
    // A new authentication means a different wallet: the numbers on screen were
    // computed for the previous one, so the server decides again.
    mocks.wallet.authenticatedAt = 2;
    rendered.rerender(<CpuHolderGate initial={view()} />);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});

describe("signed-out gate", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.openConnect.mockReset();
    mocks.wallet.address = null;
    mocks.wallet.authenticated = false;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "NOT_AUTHENTICATED" })));
  });

  it("starts wallet connection from the gate", () => {
    render(<CpuSignedOutGate required="1,000,000" minimumBalance={1_000_000} buyUrl={buyUrl} />);
    fireEvent.click(screen.getByRole("button", { name: /Connect Wallet/ }));
    expect(mocks.openConnect).toHaveBeenCalled();
    const buy = screen.getByRole("link", { name: /Buy \$CPU/ });
    expect(buy).toHaveAttribute("href", buyUrl);
    expect(buy).toHaveAttribute("target", "_blank");
  });
});

describe("long-session status monitor", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.refresh.mockReset();
  });

  it("reloads the page when the server reports the wallet dropped below the minimum", async () => {
    const reload = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, reason: "INSUFFICIENT_CPU", message: "You need 1,000,000 $CPU to enter." })));
    Object.defineProperty(window, "location", { configurable: true, value: { reload } });
    render(<CpuAccessStatusMonitor intervalMs={10} />);
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 2_000 });
  });

  it("does not reload on a transient failure", async () => {
    const reload = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    Object.defineProperty(window, "location", { configurable: true, value: { reload } });
    render(<CpuAccessStatusMonitor intervalMs={10} />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reload).not.toHaveBeenCalled();
  });
});
