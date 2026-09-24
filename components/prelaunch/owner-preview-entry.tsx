import Link from "next/link";

export function OwnerPreviewEntry() {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-8">
      <p className="text-xs text-[var(--cabi-text-secondary)]">Welcome back. Your private preview is ready.</p>
      <Link href="/preview" className="focus-ring rounded-xl bg-[var(--cabi-primary)] px-4 py-2 text-xs font-semibold text-[var(--cabi-on-primary)]">Enter Cabi Preview</Link>
    </div>
  );
}
