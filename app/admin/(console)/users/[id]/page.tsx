import { AdminUserDetail } from "@/components/admin/admin-user-detail";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "User", robots: { index: false, follow: false } };

type Params = { params: Promise<{ id: string }> };

export default async function AdminUserPage({ params }: Params) {
  const { id } = await params;
  return <AdminUserDetail walletAccountId={id} />;
}