"use client";

import { useEffect, useState } from "react";

type OwnerWallet = {
  id: string | null;
  walletAddress: string;
  label: string;
  enabled: boolean;
  source: "database" | "environment";
  lastUsedAt: string | null;
};

export function OwnerWalletsPanel() {
  const [wallets, setWallets] = useState<OwnerWallet[]>([]);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/admin/owner-wallets", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { wallets?: OwnerWallet[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load owner wallets.");
        setWallets(result.wallets ?? []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load owner wallets."));
  }, []);

  const change = async (method: "POST" | "DELETE", walletAddress: string, walletLabel = "") => {
    if (!window.confirm(method === "POST"
      ? `Authorize ${walletAddress} to open Cabi during prelaunch?`
      : `Remove preview access for ${walletAddress}? Existing preview access will stop working.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner-wallets", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, label: walletLabel, confirmed: true }),
      });
      const result = await response.json() as { wallets?: OwnerWallet[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update owner wallets.");
      setWallets(result.wallets ?? []);
      setNotice(method === "POST" ? "Wallet authorized. The change was recorded in the audit log." : "Preview access removed and recorded in the audit log.");
      if (method === "POST") { setAddress(""); setLabel(""); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update owner wallets.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-12 border-t border-[var(--cabi-hairline)] pt-10">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--cabi-primary)]">Owner wallets</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Authorized Preview Wallets</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--cabi-text-muted)]">Only wallets added here or configured for bootstrap can enter the private Cabi preview after signing in. Removing one takes effect on its next request.</p>

      <div className="mt-5 space-y-2">
        {wallets.length === 0 && <p className="rounded-2xl border border-[var(--cabi-hairline)] p-4 text-sm text-[var(--cabi-text-muted)]">No owner wallets are authorized yet.</p>}
        {wallets.map((wallet) => (
          <div key={wallet.walletAddress} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] p-4">
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-sm text-white">{wallet.walletAddress}</p>
              <p className="mt-1 text-xs text-[var(--cabi-text-muted)]">{wallet.label || "Owner wallet"} · {wallet.source === "environment" ? "Bootstrap" : "Saved"} · {wallet.enabled ? "Active" : "Removed"}</p>
              {wallet.lastUsedAt && <p className="mt-1 text-[11px] text-[var(--cabi-text-faint)]">Last used {new Date(wallet.lastUsedAt).toLocaleString()}</p>}
            </div>
            {wallet.enabled ? (
              <button type="button" disabled={busy} onClick={() => void change("DELETE", wallet.walletAddress)} className="focus-ring rounded-xl border border-rose-300/20 px-4 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50">Remove</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void change("POST", wallet.walletAddress, wallet.label)} className="focus-ring rounded-xl border border-violet-300/20 px-4 py-2 text-xs font-semibold text-[var(--cabi-primary)] disabled:opacity-50">Restore</button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface)] p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="text-xs text-[var(--cabi-text-secondary)]">EVM wallet address
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" className="mt-2 w-full rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-bg)] px-3 py-2.5 font-mono text-sm text-white" />
        </label>
        <label className="text-xs text-[var(--cabi-text-secondary)]">Label
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Owner wallet" maxLength={100} className="mt-2 w-full rounded-xl border border-[var(--cabi-border)] bg-[var(--cabi-bg)] px-3 py-2.5 text-sm text-white" />
        </label>
        <button type="button" disabled={busy || !address.trim()} onClick={() => void change("POST", address, label)} className="focus-ring h-9 rounded-xl bg-[var(--cabi-primary)] px-4 text-sm font-semibold text-[var(--cabi-on-primary)] disabled:opacity-50">Add Wallet</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-[var(--cabi-primary)]">{notice}</p>}
    </section>
  );
}
