import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CABI_FEATURES,
  cabiRoadmapFeatures,
  defaultFeatureFlags,
  featureFlagKeys,
  lockedFeatureCopy,
  lockedFeatureOrder,
  parseFeatureFlags,
  roadmapFeatureCount,
} from "@/lib/config/feature-flags";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/**
 * The locked-feature system.
 *
 * This phase ships five surfaces and presents everything else as intentionally
 * unreleased. These tests hold the two promises that matter: nothing unfinished
 * is reachable, and nothing unfinished is described as working.
 */

const activeFlags = ["chat_enabled", "image_generation_enabled", "wallet_auth_enabled", "memory_enabled", "profile_enabled", "ranking_enabled", "leaderboard_enabled"] as const;
const lockedFlags = ["portfolio_enabled", "direct_trading_enabled", "rewards_enabled", "achievements_enabled", "gallery_enabled"] as const;

describe("default flags match what this phase ships", () => {
  it("enables the core experience, ranks, and leaderboards", () => {
    for (const key of activeFlags) expect(defaultFeatureFlags[key]).toBe(true);
  });

  it("leaves every unfinished feature off", () => {
    for (const key of lockedFlags) expect(defaultFeatureFlags[key]).toBe(false);
  });

  it("declares a flag for every documented key", () => {
    expect(featureFlagKeys).toHaveLength(activeFlags.length + lockedFlags.length);
    for (const key of [...activeFlags, ...lockedFlags]) expect(featureFlagKeys).toContain(key);
  });
});

describe("flags cannot be turned on by malformed settings", () => {
  it("ignores a string that looks like a boolean", () => {
    // A hand-edited settings row must not override the server default.
    const flags = parseFeatureFlags({ ranking_enabled: "false", leaderboard_enabled: "true" });
    expect(flags.ranking_enabled).toBe(true);
    expect(flags.leaderboard_enabled).toBe(true);
  });

  it("ignores null, numbers and objects", () => {
    const flags = parseFeatureFlags({ portfolio_enabled: 1, rewards_enabled: null, gallery_enabled: {} });
    expect(flags.portfolio_enabled).toBe(false);
    expect(flags.rewards_enabled).toBe(false);
    expect(flags.gallery_enabled).toBe(false);
  });

  it("accepts a real boolean in both directions", () => {
    expect(parseFeatureFlags({ ranking_enabled: true }).ranking_enabled).toBe(true);
    expect(parseFeatureFlags({ chat_enabled: false }).chat_enabled).toBe(false);
  });

  it("falls back to defaults for a missing or unknown payload", () => {
    expect(parseFeatureFlags(undefined)).toEqual(defaultFeatureFlags);
    expect(parseFeatureFlags({ nonsense: true })).toEqual(defaultFeatureFlags);
  });
});

describe("locked routes cannot be bypassed", () => {
  const gated: Array<[string, string]> = [
    ["app/portfolio/page.tsx", "portfolio_enabled"],
    ["app/gallery/page.tsx", "gallery_enabled"],
  ];

  it.each(gated)("%s is closed on its flag before anything else", (file, flag) => {
    const source = read(file);
    expect(source).toContain("readFeatureFlags");
    expect(source).toContain(`flags.${flag}`);
    expect(source).toContain("LockedFeatureScreen");
  });

  it("checks the flag before the site-mode gate, so it is closed in LIVE too", () => {
    for (const [file] of gated) {
      const source = read(file);
      // A LIVE deployment must not be enough to open an unfinished route.
      expect(source.indexOf(`flags.`)).toBeLessThan(source.indexOf("getAppAccess()"));
    }
  });

  it("returns the locked screen before it can render any feature content", () => {
    for (const [file, flag] of gated) {
      const source = read(file);
      // The flag check must come first in the component body, and its branch
      // must not sit after any feature component. Imports are exempt: they are
      // hoisted and render nothing on their own.
      const body = source.slice(source.indexOf("export default"));
      const gate = body.indexOf(`flags.${flag}`);
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(body.slice(0, gate)).not.toMatch(/<[A-Z]/u);
    }
  });
});

describe("locked APIs are closed too, not just the pages", () => {
  const apiGates: Array<[string, string]> = [
    ["app/api/leaderboard/route.ts", "leaderboard_enabled"],
    ["app/api/portfolio/route.ts", "portfolio_enabled"],
    ["app/api/gallery/route.ts", "gallery_enabled"],
    ["app/api/cabi/route.ts", "leaderboard_enabled"],
  ];

  it.each(apiGates)("%s refuses when its feature is locked", (file, flag) => {
    const source = read(file);
    expect(source).toContain("featureGate");
    expect(source).toContain(`featureGate("${flag}")`);
  });

  it("gates before any handler does work, so no data is read", () => {
    for (const [file] of apiGates) {
      const source = read(file);
      const gateAt = source.indexOf("featureGate(");
      // A gate placed after the database read would still have fetched the data.
      const readAt = source.indexOf("getServiceClient()");
      if (readAt >= 0) expect(gateAt).toBeLessThan(readAt);
    }
  });

  it("answers 404 rather than 403, so a locked endpoint is not confirmed", () => {
    const gate = read("lib/config/feature-gate.ts");
    expect(gate).toContain("404");
    expect(gate).toContain("FEATURE_LOCKED");
  });

  it("keeps the live image API open, since image generation is shipping", () => {
    const source = read("app/api/images/route.ts");
    expect(source).toContain('featureGate("image_generation_enabled")');
    expect(defaultFeatureFlags.image_generation_enabled).toBe(true);
  });
});

describe("locked copy never claims a feature works", () => {
  it("has copy for every lockable flag", () => {
    for (const key of lockedFeatureOrder) {
      expect(lockedFeatureCopy[key]).toBeDefined();
      expect(lockedFeatureCopy[key].title.length).toBeGreaterThan(3);
      expect(lockedFeatureCopy[key].description.length).toBeGreaterThan(8);
    }
  });

  it("labels each one as in the works rather than available", () => {
    const serialized = JSON.stringify(lockedFeatureCopy).toLowerCase();
    for (const banned of ["available now", "is live", "launch now", "try it now", "coming soon!"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("shows no data of any kind", () => {
    const card = read("components/features/locked-feature.tsx");
    // A locked card takes a flag key, never a value to display.
    expect(card).toContain("flagKey");
    expect(card).not.toMatch(/\b(balance|rank|xp|score|price|holders)\b\s*[:=]/iu);
  });

  it("never routes the user into the unfinished interface", () => {
    const card = read("components/features/locked-feature.tsx");
    // The card reports a notice; it must not link or navigate.
    expect(card).not.toContain("href=");
    expect(card).not.toContain("router.push");
  });
});

describe("flags are server-authoritative", () => {
  it("resolves flags on the server, never from the client", () => {
    const server = read("lib/config/feature-flags.server.ts");
    expect(server).toContain('import "server-only"');
    expect(server).toContain("getServiceClient");
  });

  it("fails closed when the database is unavailable", () => {
    const server = read("lib/config/feature-flags.server.ts");
    // Every early return must be the defaults, never an all-on object.
    expect(server).not.toMatch(/return\s*\{\s*\.\.\.defaultFeatureFlags,\s*\w+:\s*true/u);
    expect((server.match(/return \{ \.\.\.defaultFeatureFlags \}/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects unknown flag keys instead of storing them", () => {
    const api = read("app/api/admin/flags/route.ts");
    expect(api).toContain("UNKNOWN_FLAG");
    expect(api).toContain("featureFlagKeys");
  });

  it("audits a flag change", () => {
    const api = read("app/api/admin/flags/route.ts");
    expect(api).toContain("auditAdmin");
    expect(api).toContain("feature_flags.save");
  });

  it("defaults the chat shell to the shipped configuration, not to everything on", () => {
    const shell = read("components/cabi/cabi-experience.tsx");
    // A caller that forgets to pass flags must get the locked state.
    expect(shell).toContain("flags = defaultFeatureFlags");
  });
});

describe("the app passes resolved flags to the chat shell", () => {
  it("reads flags on the server for the main page", () => {
    const home = read("app/page.tsx");
    expect(home).toContain("readFeatureFlags");
    // The application is rendered through the $CPU holder gate, which resolves
    // access on the server before this element is produced.
    expect(home).toContain("<CabiExperience flags={flags} cpuGateBypassed={bypassed} statusMessages={statusMessages ?? undefined} />");
    expect(home).toContain("cpuGatedPage");
    // Owner-added activity lines are resolved on the server and passed down.
    expect(home).toContain("readActiveStatusOverrides");
  });

  it("keeps unfinished features out of chat and gives them a lab destination", () => {
    const shell = read("components/cabi/cabi-experience.tsx");
    expect(shell).not.toContain("lockedFeatureOrder");
    expect(shell).not.toContain("LockedFeatures");
    const lab = read("app/lab/page.tsx");
    expect(lab).toContain("cabiRoadmapFeatures");
    expect(lab).toContain("In the works");
  });

  it("keeps the four remaining future cards in one canonical registry", () => {
    expect(cabiRoadmapFeatures).toHaveLength(4);
    expect(cabiRoadmapFeatures.map((feature) => feature.label)).toEqual([
      "Portfolio",
      "Automated Trading",
      "Rewards",
      "Achievements",
    ]);
    expect(CABI_FEATURES.filter((feature) => feature.surface === "roadmap")).toEqual(cabiRoadmapFeatures);
  });

  it("keeps the primary navigation minimal", () => {
    const shell = read("components/cabi/cabi-experience.tsx");
    const nav = shell.slice(shell.indexOf('aria-label="Primary"'));
    const primary = nav.slice(0, nav.indexOf("</nav>"));
    // Chat and $CPU only: locked destinations must not be top-level links.
    expect(primary).not.toContain('href="/leaderboard"');
    expect(primary).not.toContain('href="/gallery"');
    expect(primary).not.toContain('href="/portfolio"');
  });

  it("shows only future work in Cabi Lab and updates the sidebar count from the registry", () => {
    expect(roadmapFeatureCount).toBe(4);
    const shell = read("components/cabi/cabi-experience.tsx");
    expect(shell).toContain("{roadmapFeatureCount} things in the works");
    expect(shell).toContain('href="/leaderboard"');
    expect(shell).toContain("<Trophy");
  });
});
