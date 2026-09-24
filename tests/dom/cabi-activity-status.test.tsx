import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CabiActivityStatus } from "@/components/cabi/cabi-activity-status";
import { cabiStatusAnnouncements, cabiStatusDefaults } from "@/lib/cabi/status-messages";

/**
 * The rendered activity indicator.
 *
 * What is checked here is what a person and a screen reader actually experience:
 * the text rotates, it does not flicker, the escalation appears only after real
 * elapsed time, motion is removed when the user asks for that, and the live region
 * announces one stable sentence instead of every rotation.
 */

function mockReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mockReducedMotion(false);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("activity status", () => {
  it("shows one of Cabi's own lines for the activity", () => {
    render(<CabiActivityStatus type="CHAT_THINKING" />);
    const shown = cabiStatusDefaults.CHAT_THINKING.some((line) => screen.queryByText(line) !== null);
    expect(shown).toBe(true);
  });

  it("uses the image lines for image generation", () => {
    render(<CabiActivityStatus type="IMAGE_GENERATING" />);
    const shown = cabiStatusDefaults.IMAGE_GENERATING.some((line) => screen.queryByText(line) !== null);
    expect(shown).toBe(true);
  });

  it("rotates the visible line over time", async () => {
    render(<CabiActivityStatus type="IMAGE_GENERATING" />);
    const first = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    // Advancing beyond the maximum first delay guarantees exactly one
    // rotation without allowing a random sequence to wrap back to the first line.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    const later = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    expect(later).not.toBe(first);
  });

  it("does not change the line on a fast interval", async () => {
    render(<CabiActivityStatus type="CHAT_THINKING" />);
    const before = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const after = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    // 500ms rotation is what the brief forbids: nothing may change this fast.
    expect(after).toBe(before);
  });

  it("escalates to the longer-wait line only after real elapsed time", async () => {
    render(<CabiActivityStatus type="IMAGE_GENERATING" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(screen.getByText("Still working on it...")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("This one's taking a little longer.")).toBeInTheDocument();
  });

  it("shows no percentage anywhere", () => {
    render(<CabiActivityStatus type="IMAGE_GENERATING" mascot />);
    expect(document.body.textContent ?? "").not.toMatch(/\d{1,3}\s?%/u);
  });

  it("announces one stable sentence and hides the rotating text from assistive tech", () => {
    render(<CabiActivityStatus type="MEMORY_LOADING" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(cabiStatusAnnouncements.MEMORY_LOADING);
    // The visible line is decorative, so it must not be part of the live region.
    const live = status.textContent ?? "";
    for (const line of cabiStatusDefaults.MEMORY_LOADING) {
      expect(live).not.toContain(line);
    }
  });

  it("does not spam the live region while the text rotates", async () => {
    render(<CabiActivityStatus type="CHAT_THINKING" />);
    const before = screen.getByRole("status").textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    // Rotating visible text must not change what is announced.
    expect(screen.getByRole("status").textContent).toBe(before);
  });

  it("removes motion when the user asks for reduced motion", () => {
    mockReducedMotion(true);
    render(<CabiActivityStatus type="IMAGE_GENERATING" mascot />);
    const mascot = document.querySelector(".cabi-mascot-breathe");
    expect(mascot).toBeNull();
    // The bar is a static hairline rather than a sliding sliver.
    expect(document.querySelector(".cabi-activity-slide")).toBeNull();
  });

  it("keeps the messages working with reduced motion", async () => {
    mockReducedMotion(true);
    render(<CabiActivityStatus type="CHAT_THINKING" />);
    const first = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    const later = document.querySelector("[data-cabi-status]")?.textContent ?? "";
    expect(later).not.toBe(first);
  });

  it("renders the mascot image by default and can omit it", () => {
    const { unmount } = render(<CabiActivityStatus type="CHAT_THINKING" />);
    expect(document.querySelector('img[src="/assets/cabi-mascot.png"]')).not.toBeNull();
    unmount();
    render(<CabiActivityStatus type="CHAT_THINKING" mascot={false} />);
    expect(document.querySelector('img[src="/assets/cabi-mascot.png"]')).toBeNull();
  });

  it("accepts owner-added lines", () => {
    render(<CabiActivityStatus type="CHAT_THINKING" overrides={{ CHAT_THINKING: ["Booting my little CPU..."] }} />);
    expect(document.querySelector("[data-cabi-status]")).not.toBeNull();
    // The default set is still present, so rotation never runs short.
    expect(cabiStatusDefaults.CHAT_THINKING.length).toBeGreaterThan(1);
  });

  it("keeps a fixed row so nothing below it moves", () => {
    render(<CabiActivityStatus type="CHAT_THINKING" />);
    const row = document.querySelector("[data-cabi-status]");
    expect(row?.className).toContain("min-h-[18px]");
  });
});
