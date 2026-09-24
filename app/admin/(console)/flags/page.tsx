import { AdminFlagsPanel } from "@/components/admin/admin-flags-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Feature Flags", robots: { index: false, follow: false } };

export default function AdminFlagsPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] p-5 sm:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-[-0.02em]">Feature Flags</h1>
        <p className="mt-1.5 text-xs leading-6 text-[var(--cabi-text-muted)]">
          Which parts of Cabi are open. Everything closed here is presented to visitors as intentionally in development.
        </p>
      </header>
      <AdminFlagsPanel />
    </div>
  );
}