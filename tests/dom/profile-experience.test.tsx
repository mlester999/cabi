import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/prelaunch/preview-link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/profile/my-cabi-images", () => ({ MyCabiImages: () => null }));
vi.mock("@/components/ranking/share-rank-card", () => ({ ShareRankCard: () => null }));

import { ProfileExperience } from "@/components/profile/profile-experience";
import { rankTiers } from "@/lib/ranking/tiers";

describe("profile avatar display", () => {
  it("shows the signed avatar URL returned by the rank profile API", async () => {
    const avatarUrl = "https://storage.example.com/private/avatar.png?token=short-lived";
    const current = rankTiers[0];
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        identity: {
          username: "dev",
          displayName: "dev",
          initials: "DE",
          avatarUrl,
          joinedAt: null,
          rankingStatus: "NORMAL",
        },
        monthly: null,
        weekly: null,
        lifetime: { xp: 5, messages: 1, bestTier: null, bestPlacement: null, seasons: 0 },
        history: [],
        achievements: [],
        bond: { level: 1, label: "New Friend", progress: 50, conversationDays: 2, memoryCount: 0 },
        progress: { current, next: rankTiers[1], xp: 5, toNext: 495, percent: 1 },
      }),
    } as Response);

    render(<ProfileExperience />);

    const avatar = await screen.findByRole("img", { name: "dev avatar" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", avatarUrl);
  });
});
