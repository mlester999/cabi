import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>,
}));

/*
 * The prelaunch tree includes a preview banner and the public nav, both of which
 * use app-router hooks. This suite renders them outside a Next router, so the
 * hooks are stubbed rather than the components being changed.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { PrelaunchExperience } from "@/components/prelaunch/prelaunch-experience";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { defaultPrelaunchSettings } from "@/lib/site/prelaunch-shared";
import type { PrelaunchSettings } from "@/lib/site/prelaunch-shared";
import type { PublicWalletConfig } from "@/lib/wallet/client";
import { fallbackCpuDescription } from "@/lib/wallet/public-defaults";

const CHAIN_ID = 8453;
const CPU_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

const chain = {
  id: CHAIN_ID,
  name: "Configured EVM Network",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.example.com",
  blockExplorerUrl: "https://explorer.example.com",
  iconUrl: "",
  enabled: true,
};

function walletConfig(overrides: Partial<PublicWalletConfig["cpu"]> = {}): PublicWalletConfig {
  return {
    chains: [chain],
    primaryChainId: CHAIN_ID,
    cpu: {
      tokenName: "Cat Partner Unit",
      ticker: "CPU",
      launchStatus: "PRELAUNCH",
      contractAddress: "",
      chainId: null,
      clankTradeUrl: "",
      explorerUrl: "",
      xUrl: "",
      websiteUrl: "",
      description: "",
      ...overrides,
    },
  };
}

const liveCpu = walletConfig({
  launchStatus: "LIVE",
  contractAddress: CPU_ADDRESS,
  chainId: CHAIN_ID,
  clankTradeUrl: "https://clank.trade/coin/cpu",
});

/**
 * The real page renders inside the root layout's WalletProvider, which hydrates
 * the wallet session and public config on mount. Both are irrelevant here, and
 * the mount effects are flushed inside `act` so nothing updates after a test.
 */
async function renderPrelaunch(
  settings: Partial<PrelaunchSettings> = defaultPrelaunchSettings,
  wallet = walletConfig(),
) {
  const result = render(
    <WalletProvider>
      <PrelaunchExperience settings={{ ...defaultPrelaunchSettings, ...settings }} wallet={wallet} />
    </WalletProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return result;
}

beforeEach(() => {
  // The provider hydrates wallet session + public config on mount. Both are
  // irrelevant here, so they resolve to "not signed in, nothing configured".
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/wallet/session")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ chains: [], primaryChainId: null, cpu: walletConfig().cpu }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});

describe("prelaunch page", () => {
  it("renders the brand, headline, and supporting copy", async () => {
    await renderPrelaunch();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cabi is getting ready.");
    expect(screen.getAllByText(/still working on the tech/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Soon you'll be able to talk with Cabi/i)).toBeInTheDocument();
    expect(screen.getAllByText("CABI").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cat Partner Unit/i).length).toBeGreaterThan(0);
  });

  it("shows the animated system status without any fabricated percentage", async () => {
    const { container } = await renderPrelaunch();
    for (const label of ["Personality Core", "Memory", "Wallet Connection", "Clank.trade", "Cat Mode"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // The "Preparing..." dots animate; a completion percentage must never appear.
    expect(container.textContent ?? "").not.toMatch(/\d{1,3}\s*%/u);
    expect(container.textContent ?? "").not.toMatch(/complete/iu);
    expect(screen.getAllByText("CABI SYSTEM").length).toBe(2);
  });

  it("does not claim an exact release date", async () => {
    const { container } = await renderPrelaunch();
    expect(container.textContent ?? "").not.toMatch(/launch(es|ing)? on|releases? on|q[1-4] 20\d\d|tba/iu);
  });

  it("does not promise or expose wallet transaction controls", async () => {
    const { container } = await renderPrelaunch();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Cabi prepares\. You confirm\.|wallet signs|builds? the (?:trade|transaction|request)/iu);
    expect(container.querySelector("[data-wallet-transaction]")).toBeNull();
  });

  it("keeps the cabi mascot and character present as decorative art", async () => {
    await renderPrelaunch();
    expect(screen.getAllByLabelText(/Cabi, the purple Cat Partner Unit mascot/i).length).toBeGreaterThan(0);
    // The hero uses the official supplied character render, with the higher
    // resolution main render as its only fallback.
    const art = screen.getAllByAltText(/Cabi, the purple Cat Partner Unit, getting ready/i);
    expect(art.length).toBe(2);
    expect(art[0]).toHaveAttribute("src", "/assets/cabi-cpu-model.png");
  });

  it("renders the coming-with-cabi feature chips from settings", async () => {
    await renderPrelaunch({ featureChips: ["Chat", "Memory", "Wallet", "Clank.trade"] });
    for (const chip of ["Chat", "Memory", "Wallet", "Clank.trade"]) {
      expect(screen.getAllByText(chip).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/Coming soon/i).length).toBeGreaterThan(0);
  });

  it("uses the desktop character-first order and stacks cleanly on mobile", async () => {
    const { container } = await renderPrelaunch();
    // Mobile shows the character above the copy; desktop hides that copy and
    // renders the large character on the right instead.
    const mobileArt = container.querySelector(".lg\\:hidden");
    const desktopArt = container.querySelector(".lg\\:block");
    expect(mobileArt).not.toBeNull();
    expect(desktopArt).not.toBeNull();
    expect(container.querySelector("[class*='lg:grid-cols-']")).not.toBeNull();
    // No fixed pixel width may force horizontal overflow on a 320px screen.
    expect(container.querySelector(".min-w-\\[1240px\\]")).toBeNull();
    expect(container.firstElementChild?.className).toContain("overflow-x-hidden");
  });

  it("honours the owner's announcement", async () => {
    await renderPrelaunch({ announcement: "Cabi is nearly ready." });
    expect(screen.getByText("Cabi is nearly ready.")).toBeInTheDocument();
  });

  it("keeps the decorative terminal hidden from assistive tech and out of the way", async () => {
    const { container } = await renderPrelaunch();
    const terminal = container.querySelector("[data-cabi-terminal]");
    expect(terminal).not.toBeNull();
    expect(terminal?.getAttribute("aria-hidden")).toBe("true");
    expect(terminal?.textContent).toContain("cabi@unit");
    // It is decorative: it must never become the page's main content.
    expect(container.querySelectorAll("h1").length).toBe(1);
  });

  it("answers a click on the mascot with a playful line", async () => {
    await renderPrelaunch();
    const mascot = screen.getByRole("button", { name: /Cabi, your Cat Partner Unit/i });
    expect(screen.queryByText(/Still working on it/i)).toBeNull();

    await act(async () => { fireEvent.click(mascot); });
    expect(screen.getByText(/Still working on it/i)).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Cabi says/i })); });
    expect(screen.getByText(/going as fast as I can/i)).toBeInTheDocument();
  });

  it("gives every interactive control an accessible name and a focus ring", async () => {
    await renderPrelaunch({ showSocial: true, xUrl: "https://x.com/cabi", cpuStatus: "LIVE" }, liveCpu);
    const controls: HTMLElement[] = [
      screen.getByRole("button", { name: /Cabi, your Cat Partner Unit/i }),
      screen.getByRole("button", { name: /Copy \$CPU contract/i }),
      screen.getByRole("link", { name: /Cabi on X/i }),
      screen.getByRole("link", { name: /Buy \$CPU/i }),
    ];
    for (const control of controls) {
      expect(control.className).toContain("focus-ring");
    }
  });

  it("marks purely decorative layers as hidden from assistive tech", async () => {
    const { container } = await renderPrelaunch();
    expect(container.querySelector(".cabi-atmosphere")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".cabi-grain")?.getAttribute("aria-hidden")).toBe("true");
    // The character image carries real alternative text.
    expect(screen.getAllByAltText(/Cabi, the purple Cat Partner Unit, getting ready/i).length).toBe(2);
  });
});

describe("$CPU on the prelaunch page", () => {
  it("shows no contract and no trade link when the owner has published nothing", async () => {
    const { container } = await renderPrelaunch({ cpuStatus: "PRELAUNCH" }, walletConfig());
    // The neutral product copy still explains what $CPU is.
    expect(screen.getByText(fallbackCpuDescription)).toBeInTheDocument();
    // Nothing about a token destination may be invented, at any site mode.
    expect(container.textContent ?? "").not.toMatch(/0x[0-9a-fA-F]{40}/u);
    expect(screen.queryByRole("link", { name: /Clank\.trade/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy \$CPU contract/i })).toBeNull();
    expect(screen.getAllByText(/Coming soon/i).length).toBeGreaterThan(0);
  });

  it("still publishes nothing when CPU is marked live but unconfigured", async () => {
    const { container } = await renderPrelaunch({ cpuStatus: "LIVE" }, walletConfig());
    expect(container.textContent ?? "").not.toMatch(/0x[0-9a-fA-F]{40}/u);
    expect(screen.queryByRole("link", { name: /Clank\.trade/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Buy/i })).toBeNull();
  });

  it("displays the configured address and network when CPU is live", async () => {
    await renderPrelaunch({ cpuStatus: "LIVE" }, liveCpu);
    expect(screen.getByText(CPU_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("Configured EVM Network")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy \$CPU contract/i })).toBeInTheDocument();
  });

  it("opens the configured Clank.trade URL in a safely-rel isolated new tab", async () => {
    await renderPrelaunch({ cpuStatus: "LIVE" }, liveCpu);
    const buy = screen.getByRole("link", { name: /Buy \$CPU/i });
    expect(buy).toHaveAttribute("href", "https://clank.trade/coin/cpu");
    expect(buy).toHaveAttribute("target", "_blank");
    expect(buy.getAttribute("rel")).toContain("noopener");
    expect(buy.getAttribute("rel")).toContain("noreferrer");
  });

  it("hides the buy button when the live record has no verified URL", async () => {
    const { container } = await renderPrelaunch(
      { cpuStatus: "LIVE" },
      walletConfig({ launchStatus: "LIVE", contractAddress: CPU_ADDRESS, chainId: CHAIN_ID, clankTradeUrl: "" }),
    );
    // A contract without a verified coin page is not a complete, publishable
    // token entry, so the block stays in its Coming Soon state and offers no
    // trade link at all.
    expect(container.textContent ?? "").not.toContain(CPU_ADDRESS);
    expect(screen.getAllByText(/Coming Soon/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Buy/i })).toBeNull();
    expect(container.querySelectorAll('a[href*="clank.trade"]').length).toBe(0);
  });

  it("hides the whole $CPU section when the owner turns it off", async () => {
    await renderPrelaunch({ showCpu: false }, liveCpu);
    expect(screen.queryByText(CPU_ADDRESS)).toBeNull();
  });

  it("copies the contract address to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderPrelaunch({ cpuStatus: "LIVE" }, liveCpu);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy \$CPU contract/i }));
    });
    expect(writeText).toHaveBeenCalledWith(CPU_ADDRESS);
  });
});

describe("prelaunch social links", () => {
  it("hides social links when disabled or unconfigured", async () => {
    const { rerender } = await renderPrelaunch({ showSocial: false, xUrl: "https://x.com/cabi" });
    expect(screen.queryByRole("link", { name: /Cabi on X/i })).toBeNull();

    rerender(
      <WalletProvider>
        <PrelaunchExperience settings={{ ...defaultPrelaunchSettings, showSocial: true, xUrl: "" }} wallet={walletConfig()} />
      </WalletProvider>,
    );
    expect(screen.queryByRole("link", { name: /Cabi on X/i })).toBeNull();
  });

  it("renders configured social links safely", async () => {
    await renderPrelaunch({ showSocial: true, xUrl: "https://x.com/cabi", communityUrl: "https://t.me/cabi" });
    const x = screen.getByRole("link", { name: /Cabi on X/i });
    expect(x).toHaveAttribute("href", "https://x.com/cabi");
    expect(x).toHaveAttribute("target", "_blank");
    expect(x.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: /Community/i })).toHaveAttribute("rel", "noopener noreferrer");
  });
});
