import { AdminShell } from "@/components/admin/admin-shell";
import { readAdminSession } from "@/lib/security/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await readAdminSession(); if (!session) redirect("/admin/login");
  return <AdminShell email={session.email}>{children}</AdminShell>;
}
