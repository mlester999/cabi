"use client";

import { Banner, Header } from "@/components/admin/ai-settings-panel";
import { defaultPrelaunchSettings, type PrelaunchSettings } from "@/lib/site/prelaunch-shared";
import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Field = { key: keyof PrelaunchSettings; label: string; kind?: "text" | "textarea" | "url" | "boolean" | "chips"; help?: string };

const fields: Field[] = [
  { key: "headline", label: "Prelaunch headline", help: "Shown as the page's main heading." },
  { key: "subheadline", label: "Prelaunch description", help: "One supporting sentence under the headline." },
  { key: "description", label: "Supporting copy", kind: "textarea" },
  { key: "statusLabel", label: "Status text", help: "Small label above the animated system status." },
  { key: "announcement", label: "Custom announcement", kind: "textarea", help: "Optional. Leave empty to hide the announcement bar." },
  { key: "xUrl", label: "X URL", kind: "url", help: "Must be a complete https:// link." },
  { key: "communityUrl", label: "Community URL", kind: "url" },
  { key: "featureChips", label: "Feature chips", kind: "chips", help: "Comma separated, up to six." },
  { key: "showSocial", label: "Show social links", kind: "boolean" },
  { key: "showCpu", label: "Show $CPU section", kind: "boolean" },
];

/**
 * Prelaunch page copy.
 *
 * Saving never publishes a contract address or a release date: the $CPU card
 * reads its address, network, and buy link from the verified $CPU settings
 * screen, and this panel only decides whether the section is shown.
 */
export function PrelaunchSettingsPanel() {
  const [value, setValue] = useState<PrelaunchSettings>(defaultPrelaunchSettings);
  const [initial, setInitial] = useState<PrelaunchSettings>(defaultPrelaunchSettings);
  const [databaseReady, setDatabaseReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/prelaunch", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { value: PrelaunchSettings; databaseReady: boolean };
        setValue(payload.value);
        setInitial(payload.value);
        setDatabaseReady(payload.databaseReady);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const save = async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/prelaunch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; value?: PrelaunchSettings };
      if (!response.ok) {
        setError(payload.error ?? "Couldn't save the prelaunch page.");
        return;
      }
      const saved = payload.value ?? value;
      setValue(saved);
      setInitial(saved);
      setNotice("Prelaunch page saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <Header
        eyebrow="Public page"
        title="Prelaunch content"
        description="Everything visitors read while the site is in PRELAUNCH. Contract addresses, networks, and buy links are configured on the $CPU screen and are never invented here."
      />
      {!databaseReady && <Banner>Connect Supabase before saving. These defaults are what the public page currently renders.</Banner>}

      <div className="mt-7 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface)] p-5">
        <div className="grid gap-5 lg:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className={field.kind === "textarea" ? "lg:col-span-2" : ""}>
              <span className="text-xs font-medium text-[var(--cabi-text-secondary)]">{field.label}</span>
              {field.help && <span className="ml-2 text-[10px] text-[var(--cabi-text-faint)]">{field.help}</span>}

              {field.kind === "textarea" ? (
                <textarea
                  rows={field.key === "description" ? 4 : 3}
                  value={String(value[field.key] ?? "")}
                  onChange={(event) => setValue({ ...value, [field.key]: event.target.value })}
                  className="field mt-2 h-auto resize-y py-3 leading-6"
                />
              ) : field.kind === "boolean" ? (
                <span className="mt-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(value[field.key])}
                    onChange={(event) => setValue({ ...value, [field.key]: event.target.checked })}
                    className="accent-violet-300"
                  />
                  <span className="text-xs text-[var(--cabi-text-muted)]">{Boolean(value[field.key]) ? "Visible on the prelaunch page" : "Hidden"}</span>
                </span>
              ) : field.kind === "chips" ? (
                <input
                  value={value.featureChips.join(", ")}
                  onChange={(event) => setValue({ ...value, featureChips: event.target.value.split(",").map((chip) => chip.trim()).filter(Boolean).slice(0, 6) })}
                  className="field mt-2"
                  placeholder="Chat, Memory, Wallet, Clank.trade"
                />
              ) : (
                <input
                  type={field.kind === "url" ? "url" : "text"}
                  value={String(value[field.key] ?? "")}
                  onChange={(event) => setValue({ ...value, [field.key]: event.target.value })}
                  className="field mt-2"
                  placeholder={field.kind === "url" ? "https://…" : undefined}
                />
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setValue(initial)}
          className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-4 text-sm"
        >
          <RotateCcw size={15} /> Reset
        </button>
        <button
          type="button"
          disabled={busy || !databaseReady}
          onClick={() => void save()}
          className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-[var(--cabi-primary)] px-4 text-sm font-semibold text-[var(--cabi-on-primary)] disabled:opacity-40"
        >
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />} {busy ? "Saving…" : "Save"}
        </button>
        <Link href="/" className="focus-ring flex h-11 items-center rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-4 text-sm text-[var(--cabi-text-secondary)] transition hover:bg-[var(--cabi-surface-3)]">
          Preview public page
        </Link>
        {notice && <p role="status" className="text-xs text-[var(--cabi-primary)]">{notice}</p>}
        {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
      </div>
    </section>
  );
}
