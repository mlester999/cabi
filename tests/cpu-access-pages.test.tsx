import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

/**
 * Page-level enforcement.
 *
 * The API guards are only half the story: a holder who does not qualify must not
 * receive the application markup either. These tests call the real page
 * components and inspect what they return, so "the gate runs before the app is
 * rendered" is a checked property rather than a comment.
 */

const mocks = vi.hoisted(() => {
  type Mode = "PRELAUNCH" | "LIVE" | "MAINTENANCE";
  return {
    siteMode: vi.fn(async () => ({ mode: "LIVE" as Mode, source: "database" as const, override: false })),
    walletAuth: vi.fn(async (): Promise<unknown> => null),
    adminSession: vi.fn(async (): Promise<unknown> => null),
    previewActive: vi.fn(async () => false),
    ownerPreview: vi.fn(async (): Promise<unknown> => null),
    authorizedOwner: vi.fn(async () => false),
    readContract: vi.fn(),
    redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`); }),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({ readContract: mocks.readContract }) };
});
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/site/mode", () => ({
  getSiteMode: mocks.siteMode,
  siteModeAllowsApp: (mode: string) => mode === "LIVE",
}));
vi.mock("@/lib/wallet/session", () => ({ readWalletAuth: mocks.walletAuth, walletAuthOrResponse: vi.fn(async () => ({ identity: null, response: null })) }));
vi.mock("@/lib/security/session", () => ({ readAdminSession: mocks.adminSession }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: mocks.previewActive }));
vi.mock("@/lib/site/owner-preview", () => ({ readOwnerPreviewAuth: mocks.ownerPreview }));
vi.mock("@/lib/site/owner-wallets", () => ({ isAuthorizedOwnerWallet: mocks.authorizedOwner }));
// The prelaunch experience is large and unrelated to the decision, so it is
// replaced by a spy. Everything else is real.
const prelaunch = vi.hoisted(() => ({ rendered: 0 }));
vi.mock("@/components/prelaunch/prelaunch-experience", () => ({
  PrelaunchExperience: () => { prelaunch.rendered += 1; return null; },
}));

import Home from "@/app/page";
import ProfilePage from "@/app/profile/page";
import SettingsPage from "@/app/settings/page";
import MemoryPage from "@/app/settings/memory/page";
import { invalidateCpuBalance } from "@/lib/cpu-access/balance.server";
import { invalidateCpuAccessGateSettingsCache } from "@/lib/cpu-access/settings.server";

const walletA = {
  sessionId: "s",
  walletAccountId: "a",
  profileId: "p",
  walletAddress: "0x1111111111111111111111111111111111111111" as const,
  walletAddressUniqueKey: "0x1111111111111111111111111111111111111111",
  expiresAt: "",
};

const CPU = (whole: string) => BigInt(whole) * 10n ** 18n;

function chainHolds(balance: bigint) {
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "balanceOf") return balance;
    if (functionName === "decimals") return 18;
    if (functionName === "symbol") return "CPU";
    throw new Error("unexpected call");
  });
}

/** Collects every element name in a returned React tree (a page is data, not a
 * mounted component, so the tree is inspected rather than rendered). */
function describeTree(node: ReactNode, out: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) describeTree(child as ReactNode, out); return out; }
  const element = node as ReactElement<{ children?: ReactNode }>;
  const name = typeof element.type === "string" ? element.type : (element.type as { name?: string })?.name ?? String(element.type);
  out.push(name);
  describeTree(element.props?.children, out);
  return out;
}

async function renderPage(page: () => Promise<ReactNode>) {
  return describeTree(await page());
}

describe("protected pages render the gate instead of the application", () => {
  beforeEach(() => {
    mocks.siteMode.mockReset();
    mocks.walletAuth.mockReset();
    mocks.adminSession.mockReset();
    mocks.previewActive.mockReset();
    mocks.ownerPreview.mockReset();
    mocks.authorizedOwner.mockReset();
    mocks.readContract.mockReset();
    mocks.redirect.mockClear();
    prelaunch.rendered = 0;
    mocks.siteMode.mockResolvedValue({ mode: "LIVE", source: "database", override: false });
    mocks.walletAuth.mockResolvedValue(null);
    mocks.adminSession.mockResolvedValue(null);
    mocks.previewActive.mockResolvedValue(false);
    mocks.ownerPreview.mockResolvedValue(null);
    mocks.authorizedOwner.mockResolvedValue(false);
    chainHolds(0n);
    invalidateCpuBalance();
    invalidateCpuAccessGateSettingsCache();
  });

  it("gives an unauthenticated visitor the holder gate on /, not the chat app", async () => {
    const tree = await renderPage(Home);
    expect(tree).toContain("CpuSignedOutGate");
    expect(tree).not.toContain("CabiExperience");
  });

  it("gives a wallet below the requirement the holder gate on /", async () => {
    chainHolds(CPU("225000"));
    mocks.walletAuth.mockResolvedValue(walletA);
    const tree = await renderPage(Home);
    expect(tree).toContain("CpuHolderGate");
    expect(tree).not.toContain("CabiExperience");
  });

  it("renders the application for a wallet that holds enough", async () => {
    chainHolds(CPU("1420000"));
    mocks.walletAuth.mockResolvedValue(walletA);
    const tree = await renderPage(Home);
    expect(tree).toContain("CabiExperience");
    expect(tree).not.toContain("CpuHolderGate");
  });

  it("renders the application for an approved admin wallet with no balance", async () => {
    chainHolds(0n);
    mocks.walletAuth.mockResolvedValue(walletA);
    mocks.authorizedOwner.mockResolvedValue(true);
    const tree = await renderPage(Home);
    expect(tree).toContain("CabiExperience");
    expect(tree).not.toContain("CpuHolderGate");
  });

  it("gates /profile, /settings, and /settings/memory the same way", async () => {
    for (const page of [ProfilePage, SettingsPage, MemoryPage]) {
      invalidateCpuBalance();
      mocks.walletAuth.mockResolvedValue(walletA);
      chainHolds(0n);
      const tree = await renderPage(page);
      expect(tree).toContain("CpuHolderGate");
      expect(tree).not.toContain("ProfileExperience");
      expect(tree).not.toContain("SettingsExperience");
      expect(tree).not.toContain("MemoryPanel");
    }
  });

  it("still shows the prelaunch page while the site is not LIVE, for any holder", async () => {
    mocks.siteMode.mockResolvedValue({ mode: "PRELAUNCH", source: "database", override: false });
    chainHolds(CPU("999999999"));
    mocks.walletAuth.mockResolvedValue(walletA);
    const tree = await renderPage(Home);
    expect(tree).toContain("PrelaunchExperience");
    expect(tree).not.toContain("CabiExperience");
    expect(tree).not.toContain("CpuHolderGate");
    // Holding $CPU never causes a chain read while the site is prelaunch.
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("keeps the public prelaunch page for an owner wallet during PRELAUNCH", async () => {
    mocks.siteMode.mockResolvedValue({ mode: "PRELAUNCH", source: "database", override: false });
    mocks.ownerPreview.mockResolvedValue(walletA);
    const tree = await renderPage(Home);
    // The prelaunch page is still the public page; the owner reaches the full
    // application through /preview, which is a separate authorized route.
    expect(tree).toContain("PrelaunchExperience");
    expect(tree).not.toContain("CpuHolderGate");
    expect(tree).not.toContain("CabiExperience");
  });

  it("redirects to maintenance instead of gating", async () => {
    mocks.siteMode.mockResolvedValue({ mode: "MAINTENANCE", source: "database", override: false });
    await expect(renderPage(Home)).rejects.toThrow("REDIRECT:/maintenance");
  });
});
