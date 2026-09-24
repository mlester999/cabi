import { AdminImagesPanel } from "@/components/admin/admin-images-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "CABI Image Generation", robots: { index: false, follow: false } };

export default function AdminImagesPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] p-5 sm:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-[-0.02em]">CABI IMAGE GENERATION</h1>
        <p className="mt-1.5 text-xs leading-6 text-[#8e889b]">
          Configure the Together AI image provider, Cabi&apos;s official reference, and the owner controls for safe generation.
        </p>
      </header>
      <AdminImagesPanel />
    </div>
  );
}
