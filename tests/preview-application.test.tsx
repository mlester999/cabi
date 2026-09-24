import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Walks a rendered React element tree looking for a value anywhere inside it.
 *
 * Depth-independent on purpose: the preview wrapper has gained and lost
 * intermediate divs, and an index-based assertion silently turned into a
 * failure about layout rather than about authorisation.
 */
function containsChild(node: unknown, value: string): boolean {
  if (node === value) return true;
  if (Array.isArray(node)) return node.some((entry) => containsChild(entry, value));
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return containsChild(props?.children, value);
  }
  return false;
}
const mocks = vi.hoisted(() => ({
  mode: vi.fn(),
  owner: vi.fn(),
  admin: vi.fn(),
  adminPreview: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/site/mode", () => ({ getSiteMode: mocks.mode }));
vi.mock("@/lib/site/owner-preview", () => ({ readOwnerPreviewAuth: mocks.owner }));
vi.mock("@/lib/security/session", () => ({ readAdminSession: mocks.admin }));
vi.mock("@/lib/site/preview", () => ({ isPreviewActive: mocks.adminPreview }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({}) }));

import { PreviewApplication } from "@/components/prelaunch/preview-application";

describe("private preview page boundary", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.mode.mockResolvedValue({ mode: "PRELAUNCH" });
    mocks.owner.mockResolvedValue(null);
    mocks.admin.mockResolvedValue(null);
    mocks.adminPreview.mockResolvedValue(false);
  });

  it("redirects ordinary and merely wallet-authenticated visitors", async () => {
    await expect(PreviewApplication({ children: "private app" })).rejects.toThrow("redirect:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("allows a verified owner preview and renders the real child tree", async () => {
    mocks.owner.mockResolvedValue({ walletAddress: "0x00000000000000000000000000000000000000A1" });
    const result = await PreviewApplication({ children: "private app" });
    /*
     * Searched for rather than indexed: the component wraps the children in
     * frame/content divs and has changed depth before, so `children[1]` broke
     * when a wrapper was added. What matters is that the real tree is rendered.
     */
    expect(containsChild(result, "private app")).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not permit an owner wallet alone to bypass maintenance", async () => {
    mocks.mode.mockResolvedValue({ mode: "MAINTENANCE" });
    mocks.owner.mockResolvedValue({ walletAddress: "0x00000000000000000000000000000000000000A1" });
    await expect(PreviewApplication({ children: "private app" })).rejects.toThrow("redirect:/");
    expect(mocks.owner).not.toHaveBeenCalled();
  });
});
