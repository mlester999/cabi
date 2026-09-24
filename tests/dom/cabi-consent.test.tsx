import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wallet: {
    config: {
      chains: [],
      primaryChainId: null,
      cpu: { tokenName: "Cat Partner Unit", ticker: "CPU", launchStatus: "PRELAUNCH" as const, contractAddress: "", chainId: null, clankTradeUrl: "", explorerUrl: "", xUrl: "", websiteUrl: "", description: "" },
    },
    configLoaded: true,
    authenticated: false,
    authenticatedAt: null as number | null,
    sessionLoaded: false,
    address: null as string | null,
    chainId: null as number | null,
    openConnect: vi.fn(),
    isWrongNetwork: vi.fn(() => false),
    switchNetwork: vi.fn(async () => undefined),
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

/*
 * The chat shell embeds navigation-aware chrome. This suite renders it outside a
 * Next router, so the hooks are stubbed; an unmocked `usePathname` returns null
 * and throws when the caller calls `startsWith` on it.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/wallet/wallet-provider", () => ({
  useWallet: () => state.wallet,
  WalletProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/wallet/wallet-button", () => ({
  WalletButton: () => <button type="button">Wallet</button>,
}));

import { CabiExperience } from "@/components/cabi/cabi-experience";

describe("guest transcript consent", () => {
  beforeEach(() => {
    state.wallet.authenticated = false;
    state.wallet.authenticatedAt = null;
    state.wallet.sessionLoaded = false;
    state.wallet.address = null;
    state.wallet.chainId = null;
    state.wallet.openConnect.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ conversations: [] })));
  });

  it("keeps a transcript started during session discovery temporary after a session is restored", async () => {
    const view = render(<CabiExperience />);
    fireEvent.click(screen.getByRole("button", { name: /Talk to Cabi/iu }));
    expect(screen.getByText("Hey. What should I call you?")).toBeInTheDocument();

    state.wallet.sessionLoaded = true;
    state.wallet.authenticated = true;
    state.wallet.authenticatedAt = Date.now();
    state.wallet.address = "0x00000000000000000000000000000000000000A1";
    view.rerender(<CabiExperience />);

    expect(await screen.findByRole("dialog", { name: "Save this conversation?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep Temporary" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save this conversation?" })).not.toBeInTheDocument());
    expect(screen.getByText(/Temporary in this tab/iu)).toBeInTheDocument();
  });

  it("enables normal persistence after an authenticated session loads with no guest transcript", async () => {
    state.wallet.sessionLoaded = true;
    state.wallet.authenticated = true;
    state.wallet.address = "0x00000000000000000000000000000000000000A1";
    render(<CabiExperience />);
    expect(await screen.findByText(/Saved to your wallet profile/iu)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Save this conversation?" })).not.toBeInTheDocument();
  });
});
