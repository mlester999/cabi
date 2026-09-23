import { describe, expect, it } from "vitest";

import { appApiRoutePrefixes, alwaysPublicApiRoutePrefixes, matchesRoutePrefix } from "@/lib/site/guard-config";

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
  ];

  it.each(gated)("gates %s while the site is not live", (pathname) => {
    expect(matchesRoutePrefix(pathname, appApiRoutePrefixes)).toBe(true);
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
