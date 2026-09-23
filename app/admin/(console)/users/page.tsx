import { AdminDataTable } from "@/components/admin/admin-data-table";

export default function UsersPage() {
  return (
    <AdminDataTable
      resource="users"
      title="Users"
      description="Anonymous guest chats are stored without identity. A wallet that signs in gains a profile, a rank, and a bond."
      // Each row opens the account detail, where eligibility can be changed.
      rowHref={(row) => (row.wallet_account_id ? `/admin/users/${String(row.wallet_account_id)}` : null)}
    />
  );
}