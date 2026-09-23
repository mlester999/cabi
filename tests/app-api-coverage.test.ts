import { describe, expect, it } from "vitest";

import { appApiRoutePrefixes, alwaysPublicApiRoutePrefixes, matchesRoutePrefix, publicReadApiRoutePrefixes } from "@/lib/site/guard-config";

/**
 * The site mode must be enforced by the server, not by hiding buttons. These
 * tests pin the route coverage so a new unfinished endpoint cannot be added
 * without being noticed.
 */
describe("site-mode API coverage", () => {
  const gated = [
    "/api/chat",
    "/api/conversations",
    "/api/conversations/8c1f",
    "/api/conversations/import-guest",
    "/api/memories",
    "/api/memories/8c1f",
    "/api/messages/8c1f",
    "/api/messages/8c1f/reaction",
    "/api/settings",
    "/api/data",
    "/api/data/export",
    // Social progression phase. Each of these must be gated by site mode, and
    // each must also require a wallet session of its own.
    "/api/profile",
    "/api/rank",
    "/api/images",
    "/api/gallery",
    "/api/portfolio",
    "/api/cabi",
  ];

  it.each(gated)("gates %s while the site is not live", (pathname) => {
    expect(matchesRoutePrefix(pathname, appApiRoutePrefixes)).toBe(true);
  });

  it("declares the leaderboard as a public read, not a gated app API", () => {
    // The leaderboard shows usernames and XP only. It is readable before
    // connecting a wallet, so it must not be in the gated list.
    expect(publicReadApiRoutePrefixes).toContain("/api/leaderboard");
    expect(matchesRoutePrefix("/api/leaderboard", publicReadApiRoutePrefixes)).toBe(true);
    expect(matchesRoutePrefix("/api/leaderboard", appApiRoutePrefixes)).toBe(false);
  });

  it("gates every wallet-scoped social API", () => {
    // These expose per-wallet data, so the middleware must refuse them outside
    // LIVE before any handler runs.
    for (const pathname of ["/api/profile", "/api/rank", "/api/images", "/api/gallery", "/api/portfolio", "/api/cabi"]) {
      expect(matchesRoutePrefix(pathname, appApiRoutePrefixes)).toBe(true);
      expect(matchesRoutePrefix(pathname, alwaysPublicApiRoutePrefixes)).toBe(false);
    }
  });

  it("does not gate unrelated or lookalike paths", () => {
    expect(matchesRoutePrefix("/api/settings-backup", appApiRoutePrefixes)).toBe(false);
    expect(matchesRoutePrefix("/apix/chat", appApiRoutePrefixes)).toBe(false);
    expect(matchesRoutePrefix("/cpu", appApiRoutePrefixes)).toBe(false);
  });

  it("keeps wallet authentication, public config, session, and admin reachable", () => {
    for (const pathname of ["/api/wallet/nonce", "/api/wallet/verify", "/api/wallet/session", "/api/wallet/logout", "/api/public/config", "/api/session", "/api/admin/login", "/api/admin/preview", "/api/admin/site-mode"]) {
      expect(matchesRoutePrefix(pathname, alwaysPublicApiRoutePrefixes)).toBe(true);
      expect(matchesRoutePrefix(pathname, appApiRoutePrefixes)).toBe(false);
    }
  });
});
