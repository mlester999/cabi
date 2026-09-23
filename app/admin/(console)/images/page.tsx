import { AdminImagesPanel } from "@/components/admin/admin-images-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Image Generation", robots: { index: false, follow: false } };

export default function AdminImagesPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] p-5 sm:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-[-0.02em]">Image Generation</h1>
        <p className="mt-1.5 text-xs leading-6 text-[#8e889b]">
          Cabi-only image generation. Every prompt is scoped to Cabi on the server before a provider is called.
        </p>
      </header>
      <AdminImagesPanel />
    </div>
  );
}