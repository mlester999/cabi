import { describe, expect, it } from "vitest";

import { resolveSiteModePrecedence, siteModeAllowsApp } from "@/lib/site/mode-resolve";
import { defaultSiteMode, siteModeDescriptions, siteModeLabels } from "@/lib/site/mode-shared";
import { cpuPublicationState, parsePrelaunchSettings, prelaunchSettingsSchema } from "@/lib/site/prelaunch";
import { defaultPrelaunchSettings } from "@/lib/site/prelaunch-shared";

describe("site mode precedence", () => {
  it("defaults to PRELAUNCH so the main route stays private until launch", () => {
    const resolved = resolveSiteModePrecedence({});
    expect(resolved.mode).toBe("PRELAUNCH");
    expect(resolved.source).toBe("default");
    expect(resolved.override).toBe(false);
    expect(defaultSiteMode).toBe("PRELAUNCH");
  });

  it("uses the saved database mode when the environment is silent", () => {
    expect(resolveSiteModePrecedence({ databaseMode: "LIVE" })).toEqual({ mode: "LIVE", source: "database", override: false });
    expect(resolveSiteModePrecedence({ databaseMode: "MAINTENANCE" })).toEqual({ mode: "MAINTENANCE", source: "database", override: false });
  });

  it("lets an explicit environment LIVE or MAINTENANCE override the dashboard", () => {
    expect(resolveSiteModePrecedence({ environmentMode: "LIVE", databaseMode: "PRELAUNCH" })).toEqual({ mode: "LIVE", source: "env", override: true });
    expect(resolveSiteModePrecedence({ environmentMode: "MAINTENANCE", databaseMode: "LIVE" })).toEqual({ mode: "MAINTENANCE", source: "env", override: true });
  });

  it("treats an explicit environment PRELAUNCH as an operator lock", () => {
    expect(resolveSiteModePrecedence({ environmentMode: "PRELAUNCH", databaseMode: "LIVE" })).toEqual({ mode: "PRELAUNCH", source: "env", override: true });
    expect(resolveSiteModePrecedence({ environmentMode: "PRELAUNCH" })).toEqual({ mode: "PRELAUNCH", source: "env", override: true });
  });

  it("ignores unparsable environment or database values instead of guessing", () => {
    expect(resolveSiteModePrecedence({ environmentMode: "  ", databaseMode: "banana" }).mode).toBe("PRELAUNCH");
    expect(resolveSiteModePrecedence({ environmentMode: "banana", databaseMode: "LIVE" }).mode).toBe("LIVE");
  });

  it("normalizes case and whitespace", () => {
    expect(resolveSiteModePrecedence({ databaseMode: " live " }).mode).toBe("LIVE");
    expect(resolveSiteModePrecedence({ environmentMode: " maintenance " }).mode).toBe("MAINTENANCE");
  });

  it("only LIVE exposes the application", () => {
    expect(siteModeAllowsApp("LIVE")).toBe(true);
    expect(siteModeAllowsApp("PRELAUNCH")).toBe(false);
    expect(siteModeAllowsApp("MAINTENANCE")).toBe(false);
  });

  it("labels every mode for the admin console", () => {
    for (const mode of ["PRELAUNCH", "LIVE", "MAINTENANCE"] as const) {
      expect(siteModeLabels[mode].length).toBeGreaterThan(0);
      expect(siteModeDescriptions[mode].length).toBeGreaterThan(0);
    }
  });
});

describe("prelaunch settings", () => {
  it("falls back to safe copy when nothing is stored", () => {
    expect(parsePrelaunchSettings(null)).toEqual(defaultPrelaunchSettings);
    expect(parsePrelaunchSettings({})).toEqual(defaultPrelaunchSettings);
  });

  it("never invents a contract address or launch date", () => {
    const parsed = parsePrelaunchSettings({ headline: "Hello", contractAddress: "0xdead", releaseDate: "tomorrow" });
    expect(parsed.headline).toBe("Hello");
    expect(JSON.stringify(parsed)).not.toContain("0xdead");
    expect(JSON.stringify(parsed)).not.toContain("tomorrow");
  });

  it("keeps the $CPU status independent from the application", () => {
    expect(parsePrelaunchSettings({ cpuStatus: "LIVE" }).cpuStatus).toBe("LIVE");
    expect(parsePrelaunchSettings({ cpuStatus: "nonsense" }).cpuStatus).toBe("PRELAUNCH");
  });

  it("requires HTTPS for social links", () => {
    expect(prelaunchSettingsSchema.safeParse({ ...defaultPrelaunchSettings, xUrl: "http://x.com/cabi" }).success).toBe(false);
    expect(prelaunchSettingsSchema.safeParse({ ...defaultPrelaunchSettings, xUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(prelaunchSettingsSchema.safeParse({ ...defaultPrelaunchSettings, xUrl: "https://x.com/cabi" }).success).toBe(true);
  });

  it("bounds the feature chips", () => {
    expect(prelaunchSettingsSchema.safeParse({ ...defaultPrelaunchSettings, featureChips: ["a", "b", "c", "d", "e", "f", "g"] }).success).toBe(false);
    expect(parsePrelaunchSettings({ featureChips: [] }).featureChips).toEqual(defaultPrelaunchSettings.featureChips);
  });

  it("publishes CPU details only when both switches agree", () => {
    expect(cpuPublicationState("LIVE", true)).toBe("LIVE");
    expect(cpuPublicationState("LIVE", false)).toBe("PRELAUNCH");
    expect(cpuPublicationState("PRELAUNCH", true)).toBe("PRELAUNCH");
    expect(cpuPublicationState("PRELAUNCH", false)).toBe("PRELAUNCH");
  });
});
