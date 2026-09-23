import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>,
}));

import { ActionCardView } from "@/components/chat/action-card";
import { ChatMessage } from "@/components/chat/chat-message";
import { SlashCommandPalette } from "@/components/chat/slash-command-palette";
import { tokenCard, tradeCard, clarifyCard } from "@/lib/actions/cards";
import type { TokenMetadata } from "@/lib/tokens/metadata";

const CPU_ADDRESS = "0x1a421A5065316d9b4062939E9959DDEcE6630528";

function token(): TokenMetadata {
  return {
    address: CPU_ADDRESS,
    symbol: "CPU",
    name: "Cat Partner Unit",
    decimals: 18,
    chainId: 8453,
    chainName: "Configured EVM Network",
    isConfiguredCpu: true,
    clankTradeUrl: "https://clank.trade/coin/cpu",
    explorerUrl: "https://explorer.example.com/address/0x1a421A5065316d9b4062939E9959DDEcE6630528",
    origin: "CONFIGURED",
  };
}

describe("action card rendering", () => {
  it("renders token details and safe external links", () => {
    render(<ActionCardView card={tokenCard(token())} />);
    expect(screen.getByText(/Cat Partner Unit/)).toBeInTheDocument();
    expect(screen.getByText(CPU_ADDRESS)).toBeInTheDocument();
    const clank = screen.getByRole("link", { name: /Clank\.trade/i });
    expect(clank).toHaveAttribute("href", "https://clank.trade/coin/cpu");
    expect(clank).toHaveAttribute("target", "_blank");
    expect(clank.getAttribute("rel")).toContain("noopener");
    expect(clank.getAttribute("rel")).toContain("noreferrer");
  });

  it("offers a copy control for the contract", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ActionCardView card={tokenCard(token())} />);
    screen.getByRole("button", { name: /Copy contract/i }).click();
    expect(writeText).toHaveBeenCalledWith(CPU_ADDRESS);
  });

  it("states that nothing happens without the user, on a trade card", () => {
    render(<ActionCardView card={tradeCard({
      action: "BUY",
      intent: { action: "BUY", tokenAddress: CPU_ADDRESS, amount: "0.02", amountType: "NATIVE" },
      token: { address: CPU_ADDRESS, symbol: "CPU", name: "Cat Partner Unit" },
      chainName: "Configured EVM Network",
      route: "Clank.trade",
      state: "AWAITING_USER_CONFIRMATION",
      directExecution: false,
      clankTradeUrl: "https://clank.trade/coin/cpu",
    })} />);
    expect(screen.getByText(/never signs, approves, or sends anything on her own/i)).toBeInTheDocument();
    expect(screen.queryByText(/estimated receive/i)).toBeNull();
    expect(screen.queryByText(/network fee/i)).toBeNull();
  });

  it("lists clarification options", () => {
    render(<ActionCardView card={clarifyCard({ question: "Which $ABC?", options: [{ id: "a", label: "ABC One", detail: "0x1a42...0528" }] })} />);
    expect(screen.getByText("ABC One")).toBeInTheDocument();
    expect(screen.getByText("Which $ABC?")).toBeInTheDocument();
  });

  it("renders a card inside a chat message", () => {
    render(<ChatMessage message={{ id: "m1", role: "assistant", content: "Here's $CPU.", status: "complete", actionCard: tokenCard(token()) }} />);
    expect(screen.getByText("Here's $CPU.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Cat Partner Unit card$/ })).toBeInTheDocument();
  });

  it("renders no card when the message has none", () => {
    render(<ChatMessage message={{ id: "m2", role: "assistant", content: "Just talking.", status: "complete" }} />);
    expect(screen.queryByRole("region", { name: /card$/ })).toBeNull();
  });
});

describe("slash command palette", () => {
  it("stays hidden for ordinary text", () => {
    const { container } = render(<SlashCommandPalette value="hello" onRun={() => {}} onNavigate={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears for a bare slash and lists every command", () => {
    render(<SlashCommandPalette value="/" onRun={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole("listbox", { name: /Cabi commands/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/cpu/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/portfolio/i })).toBeInTheDocument();
  });

  it("filters as the user types", () => {
    render(<SlashCommandPalette value="/po" onRun={() => {}} onNavigate={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /\/portfolio/i })).toBeInTheDocument();
  });

  it("navigates for a route-backed command", () => {
    const onNavigate = vi.fn();
    const onRun = vi.fn();
    render(<SlashCommandPalette value="/portfolio" onRun={onRun} onNavigate={onNavigate} />);
    screen.getByRole("option", { name: /\/portfolio/i }).click();
    expect(onNavigate).toHaveBeenCalledWith("/portfolio");
    expect(onRun).not.toHaveBeenCalled();
  });

  it("sends an answer-backed command to Cabi", () => {
    const onNavigate = vi.fn();
    const onRun = vi.fn();
    render(<SlashCommandPalette value="/wallet" onRun={onRun} onNavigate={onNavigate} />);
    screen.getByRole("option", { name: /\/wallet/i }).click();
    expect(onRun).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});