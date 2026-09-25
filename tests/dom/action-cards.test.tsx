import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>,
}));

import { ActionCardView } from "@/components/chat/action-card";
import { ChatMessage } from "@/components/chat/chat-message";
import { SlashCommandPalette } from "@/components/chat/slash-command-palette";
import { noticeCard, tokenCard, tradeCard, clarifyCard, imageCard } from "@/lib/actions/cards";
import { cabiStatusAnnouncements, cabiStatusDefaults } from "@/lib/cabi/status-messages";
import type { ActionCard as ActionCardModel } from "@/lib/actions/types";
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

  it("shows a completed generated image inline in the chat transcript", () => {
    const card = imageCard({
      generationId: "generation-1",
      url: "https://storage.example.com/signed/generated.png?token=fresh",
      prompt: "Cabi smiling in a garden",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: false,
    });

    render(<ChatMessage message={{ id: "image-message", role: "assistant", content: "Here you go.", status: "complete", actionCard: card }} />);

    expect(screen.getByRole("img", { name: "Generated image: Cabi smiling in a garden" })).toHaveAttribute("src", card.url);
  });

  it("waits for the avatar save before showing success", async () => {
    let resolveSave!: (saved: boolean) => void;
    const save = new Promise<boolean>((resolve) => { resolveSave = resolve; });
    const onUseImageAsAvatar = vi.fn(() => save);
    const card = imageCard({
      generationId: "generation-avatar",
      url: "https://storage.example.com/signed/generated.png?token=fresh",
      prompt: "Cabi smiling in a garden",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: true,
      initials: "DE",
    });

    render(<ChatMessage message={{ id: "avatar-message", role: "assistant", content: "Here you go.", status: "complete", actionCard: card }} onUseImageAsAvatar={onUseImageAsAvatar} />);
    const button = screen.getByRole("button", { name: /Use as profile picture/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(screen.queryByText("Saved as your profile picture.")).toBeNull();
    await act(async () => { resolveSave(true); await save; });

    expect(await screen.findByText("Saved as your profile picture.")).toBeInTheDocument();
    expect(onUseImageAsAvatar).toHaveBeenCalledWith(card);
  });

  it("shows an error instead of success when the avatar save fails", async () => {
    const card = imageCard({
      generationId: "generation-avatar-fail",
      url: "https://storage.example.com/signed/generated.png?token=fresh",
      prompt: "Cabi smiling in a garden",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: true,
      initials: "DE",
    });

    render(<ChatMessage message={{ id: "avatar-message-fail", role: "assistant", content: "Here you go.", status: "complete", actionCard: card }} onUseImageAsAvatar={async () => false} />);
    fireEvent.click(screen.getByRole("button", { name: /Use as profile picture/i }));

    expect(await screen.findByText("I couldn't set that as your picture.")).toBeInTheDocument();
    expect(screen.queryByText("Saved as your profile picture.")).toBeNull();
  });

  it("does not render a broken image before a fresh signed URL is available", () => {
    const card = imageCard({
      generationId: "generation-2",
      url: "",
      prompt: "Cabi smiling in a garden",
      aspectRatio: "1:1",
      createdAt: "2026-09-25T00:00:00.000Z",
      canUseAsAvatar: false,
    });

    render(<ChatMessage message={{ id: "image-message-no-url", role: "assistant", content: "Here you go.", status: "complete", actionCard: card }} />);

    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders no card when the message has none", () => {
    render(<ChatMessage message={{ id: "m2", role: "assistant", content: "Just talking.", status: "complete" }} />);
    expect(screen.queryByRole("region", { name: /card$/ })).toBeNull();
  });

  it("never renders technical image diagnostics inside a chat card", () => {
    const card = {
      ...noticeCard({
        title: "Couldn't make that image.",
        message: "I ran into a problem while making it.",
        tone: "error",
        links: [{ label: "View in Admin", url: "/admin/images#recent-generation-runs", kind: "INTERNAL" }],
      }),
      debugDetails: { requestId: "private-trace-id", httpStatus: 403, provider: "Together AI" },
    } as unknown as ActionCardModel;
    render(<ActionCardView card={card} />);
    expect(screen.getByRole("link", { name: "View in Admin" })).toHaveAttribute("href", "/admin/images#recent-generation-runs");
    expect(screen.queryByText(/private-trace-id|403|Together AI|Owner preview details/i)).toBeNull();
  });

  it("renders one retry action without a duplicate empty assistant bubble", () => {
    const onRetry = vi.fn();
    render(
      <ChatMessage
        message={{
          id: "m-retry",
          role: "assistant",
          content: "",
          status: "complete",
          actionCard: noticeCard({
            title: "I could not draw that one",
            message: "I couldn't make that image right now.",
            tone: "error",
            retry: { label: "Try Again", prompt: "Generate a picture of Cabi" },
          }),
        }}
        onRetryPrompt={onRetry}
      />,
    );
    expect(screen.queryByText("…")).toBeNull();
    screen.getByRole("button", { name: /Try again/i }).click();
    expect(onRetry).toHaveBeenCalledWith("Generate a picture of Cabi", undefined);
  });

  it("shows the shared Cabi thinking status with one stable line", () => {
    vi.useFakeTimers();
    try {
      // Rendered inside act: the status component starts timers on mount, and an
      // unwrapped render leaves a pending update that can leak into the assertions.
      act(() => {
        render(<ChatMessage message={{ id: "m3", role: "assistant", content: "", status: "streaming" }} />);
      });

      /*
       * The transcript no longer carries its own thinking indicator: it renders the
       * shared `CabiActivityStatus`, which has ONE stable announcement and one
       * visible line. This test pins both properties, so a future change cannot
       * quietly reintroduce a second, faster-moving implementation.
       */
      const live = screen.getByRole("status");
      expect(live).toHaveTextContent(cabiStatusAnnouncements.CHAT_THINKING);

      const visible = document.querySelector("[data-cabi-status]");
      expect(visible).not.toBeNull();
      const first = visible?.textContent ?? "";
      expect(cabiStatusDefaults.CHAT_THINKING.some((line) => first.includes(line))).toBe(true);

      // Nothing may change this quickly: 500ms rotation is what the brief forbids.
      act(() => { vi.advanceTimersByTime(600); });
      expect(document.querySelector("[data-cabi-status]")?.textContent ?? "").toBe(first);

      // Waiting does not create another visible loader message, and the
      // announcement remains stable.
      act(() => { vi.advanceTimersByTime(12_000); });
      expect(document.querySelector("[data-cabi-status]")?.textContent ?? "").toBe(first);
      expect(screen.getByRole("status")).toHaveTextContent(cabiStatusAnnouncements.CHAT_THINKING);
    } finally {
      vi.useRealTimers();
    }
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
    expect(screen.queryByRole("option", { name: /\/portfolio/i })).not.toBeInTheDocument();
  });

  it("filters as the user types", () => {
    render(<SlashCommandPalette value="/po" onRun={() => {}} onNavigate={() => {}} />);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("does not offer locked portfolio navigation from chat", () => {
    const onNavigate = vi.fn();
    const onRun = vi.fn();
    render(<SlashCommandPalette value="/portfolio" onRun={onRun} onNavigate={onNavigate} />);
    expect(screen.queryByRole("option", { name: /\/portfolio/i })).not.toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
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
