"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Mints the admin preview opt-in cookie, then opens `/preview`.
 *
 * The cookie is signed and HttpOnly on the server; this button only asks for
 * it. Until it exists, the application routes and their APIs stay closed even
 * for a signed-in admin.
 */
export function PreviewStartButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/preview", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setError(payload.error ?? "Preview couldn't be started.");
        return;
      }
      router.push("/preview");
      router.refresh();
    } catch {
      setError("Preview couldn't be started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex flex-col items-start gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] transition hover:brightness-105 disabled:opacity-50"
      >
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Open live preview
      </button>
      {error ? <span role="alert" className="text-xs text-rose-200">{error}</span> : null}
    </span>
  );
}
