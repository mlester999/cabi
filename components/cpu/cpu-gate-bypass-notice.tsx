import { ShieldCheck } from "lucide-react";

/**
 * "ADMIN ACCESS · CPU gate bypassed" badge.
 *
 * Rendered only for a wallet the server already verified against the owner/
 * admin allowlist (see `isCpuGateBypassedForViewer`), so a normal holder never
 * sees it and no client value can produce it.
 */
export function CpuGateBypassNotice({ label = "Approved owner wallet" }: { label?: string }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-violet-200/[0.14] bg-violet-300/[0.06] px-3.5 py-2.5"
      role="status"
    >
      <ShieldCheck size={14} className="shrink-0 text-violet-200" aria-hidden="true" />
      <span className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-200">Admin access</span>
      <span className="text-[11px] text-[#a8a3b3]">$CPU gate bypassed · {label}</span>
    </div>
  );
}
