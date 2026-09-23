import { AdminLoginForm } from "@/components/admin/admin-login-form";
import type { Metadata } from "next";

/** The admin sign-in page is never indexed. */
export const metadata: Metadata = {
  title: "Admin sign-in",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLoginPage() { return <AdminLoginForm />; }
