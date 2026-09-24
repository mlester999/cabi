/**
 * DOM test setup.
 *
 * Kept intentionally small: matchers plus a few browser APIs that jsdom does
 * not implement but the prelaunch page's progressive enhancements rely on.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    // jsdom ships no matchMedia. Default to "no preference" so components take
    // their animated path, and let individual tests override the result.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (!("IntersectionObserver" in window)) {
    class NoopIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    }
    Object.defineProperty(window, "IntersectionObserver", { writable: true, configurable: true, value: NoopIntersectionObserver });
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
  }
}

afterEach(() => {
  if (typeof document !== "undefined") document.documentElement.removeAttribute("data-cabi-veil");
  // Unmount anything a rendered-component suite left behind. Without this, a
  // screen query in the next test can match the previous test's markup.
  cleanup();
});
