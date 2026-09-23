import { AdminShell } from "@/components/admin/admin-shell";
import { readAdminSession } from "@/lib/security/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The console is never indexed, and never linked from the public site. */
export const metadata: Metadata = {
  title: { default: "Admin console", template: "%s · Cabi admin" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await readAdminSession(); if (!session) redirect("/admin/login");
  return <AdminShell email={session.email}>{children}</AdminShell>;
}
