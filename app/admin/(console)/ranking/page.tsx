import { AdminRankingPanel } from "@/components/admin/admin-ranking-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ranking", robots: { index: false, follow: false } };

export default function AdminRankingPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] p-5 sm:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-[-0.02em]">Ranking</h1>
        <p className="mt-1.5 text-xs leading-6 text-[var(--cabi-text-muted)]">
          Seasonal XP, leaderboards, manual adjustments, and the reward workflow. Rank is earned from product activity and never from token ownership.
        </p>
      </header>
      <AdminRankingPanel />
    </div>
  );
}