import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appApiRoutePrefixes, alwaysPublicApiRoutePrefixes, matchesRoutePrefix, publicReadApiRoutePrefixes } from "@/lib/site/guard-config";
import { achievementCopy, achievementCodes } from "@/lib/ranking/achievements";
import { rankTiers } from "@/lib/ranking/tiers";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/**
 * The admin account view.
 *
 * Two things matter and both are easy to lose in a refactor: the view must not
 * expose private conversation content, and every mutation must be audited.
 */
describe("admin account view", () => {
  const source = read("app/api/admin/users/[id]/route.ts");

  it("never selects conversation or message content", () => {
    // Selecting a content column here would put private conversation text in
    // front of an operator, which the product policy does not allow.
    expect(source).not.toMatch(/from\("messages"\)[\s\S]{0,200}?select\([^)]*content/u);
    expect(source).not.toMatch(/from\("conversations"\)[\s\S]{0,200}?select\([^)]*title/u);
  });

  it("counts rather than reads, so eligibility is still decidable", () => {
    expect(source).toContain("countWalletMessages");
    expect(source).toContain('from("image_generations")');
    expect(source).toContain("head: true");
  });

  it("audits the eligibility change", () => {
    expect(source).toContain("auditAdmin");
    expect(source).toContain("ranking.eligibility");
  });

  it("requires an admin session on both verbs", () => {
    expect(source).toContain("adminOrResponse");
    expect((source.match(/adminOrResponse\(\)/gu) ?? []).length).toBe(2);
  });

  it("validates the account id before touching the database", () => {
    expect(source).toMatch(/\^\[0-9a-f-\]\{36\}\$/iu);
  });

  it("is gated by site mode like every other admin API", () => {
    expect(matchesRoutePrefix("/api/admin/users/abc", alwaysPublicApiRoutePrefixes)).toBe(true);
  });
});

describe("route gating is complete", () => {
  const gated = ["/api/profile", "/api/rank", "/api/images", "/api/gallery", "/api/portfolio", "/api/cabi"];
  it.each(gated)("gates %s outside LIVE", (pathname) => {
    expect(matchesRoutePrefix(pathname, appApiRoutePrefixes)).toBe(true);
    expect(matchesRoutePrefix(pathname, alwaysPublicApiRoutePrefixes)).toBe(false);
  });

  it("keeps the leaderboard public", () => {
    expect(matchesRoutePrefix("/api/leaderboard", publicReadApiRoutePrefixes)).toBe(true);
    expect(matchesRoutePrefix("/api/leaderboard", appApiRoutePrefixes)).toBe(false);
  });
});

describe("admin navigation is complete", () => {
  const shell = read("components/admin/admin-shell.tsx");

  it("links every required admin surface", () => {
    for (const href of ["/admin", "/admin/ai", "/admin/images", "/admin/personality", "/admin/knowledge", "/admin/leaderboard", "/admin/users", "/admin/conversations", "/admin/memories", "/admin/branding", "/admin/cpu", "/admin/settings", "/admin/audit"]) {
      expect(shell).toContain(`"${href}"`);
    }
  });
});

describe("no wealth in the progression model", () => {
  it("keeps rank tier copy free of token language", () => {
    const serialized = JSON.stringify(rankTiers).toLowerCase();
    for (const banned of ["token", "balance", "holder", "volume", "price", "usd", "buy"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("keeps achievement copy free of token language", () => {
    const serialized = JSON.stringify(achievementCopy).toLowerCase();
    for (const banned of ["token", "balance", "holder", "volume", "price", "usd", "buy", "cpu"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("defines exactly the eight documented achievements", () => {
    expect([...achievementCodes].sort()).toEqual([
      "FIRST_CHAT", "FIRST_IMAGE", "HUNDRED_XP", "REACHED_ELITE",
      "REACHED_LEGEND", "REACHED_MASTER", "TOP_100_WEEKLY", "TOP_10_WEEKLY",
    ].sort());
  });
});

describe("public profile exposes only safe fields", () => {
  it("does not select a wallet address or memory content", () => {
    const service = read("lib/profiles/service.ts");
    const publicFn = service.slice(service.indexOf("readPublicProfile"));
    expect(publicFn).not.toContain("wallet_address");
    expect(publicFn).not.toMatch(/user_memories/u);
    // The projection itself lives in SQL, so the page cannot widen it.
    expect(publicFn).toContain('rpc("public_profile"');
  });
});
