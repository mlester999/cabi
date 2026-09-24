import { AdminFlagsPanel } from "@/components/admin/admin-flags-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Product roadmap flags", robots: { index: false, follow: false } };

export default function AdminFeaturesPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] p-5 sm:p-8">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Product roadmap</p>
        <h1 className="mt-2 text-xl font-bold tracking-[-0.02em]">Feature flags</h1>
        <p className="mt-1.5 text-xs leading-6 text-[#8e889b]">
          Turn a finished surface on only after its route, data, and copy are ready. Closed features remain visible as intentional roadmap cards.
        </p>
      </header>
      <AdminFlagsPanel />
    </div>
  );
}
