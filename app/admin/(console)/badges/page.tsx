import { AdminBadgesPanel } from "@/components/admin/admin-badges-panel";

export default function AdminBadgesPage() {
  return <div><h1 className="text-2xl font-bold tracking-tight">Profile badges</h1><p className="mt-2 text-sm text-[#8e889b]">Create curated identity badges and assign them to completed member profiles.</p><AdminBadgesPanel /></div>;
}
