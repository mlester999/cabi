import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Images - Cabi",
  robots: { index: false, follow: false },
};

/** Keep `/images` as a short, durable entry point for the private gallery. */
export default function ImagesPage() {
  redirect("/gallery");
}
