"use client";

import { ArrowLeft, Brain, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { Switch } from "@/components/ui/switch";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";

type Memory = { id: string; category: string; content: string; created_at: string };

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "ready"; memories: Memory[]; enabled: boolean };

/**
 * What Cabi remembers.
 *
 * Every memory is shown verbatim with its category and date, and every one can be
 * removed individually. Nothing here is inferred or hidden: if Cabi knows
 * something about you, it is on this page and you can delete it.
 */
export function MemoryPanel() {
  const wallet = useWallet();
  const [state, setState] = useState<State>({ phase: "loading" });
  // Derived, not stored: a signed-out visitor is disconnected regardless of what
  // any in-flight request returned.
  const view: State = wallet.sessionLoaded && !wallet.authenticated ? { phase: "disconnected" } : state;
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const [memoriesResponse, settingsResponse] = await Promise.all([
        fetch("/api/memories", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      if (!memoriesResponse.ok) { setState({ phase: "disconnected" }); return; }
      const memories = (await memoriesResponse.json() as { memories: Memory[] }).memories;
      const enabled = settingsResponse.ok
        ? (await settingsResponse.json() as { settings: { memory_enabled: boolean } }).settings.memory_enabled
        : true;
      setState({ phase: "ready", memories, enabled });
    } catch {
      setState({ phase: "disconnected" });
    }
  }, []);

  // Only fetch once the session has settled and a wallet is actually signed in.
  // The disconnected view is derived during render rather than pushed into
  // state here, which avoids a cascading render on every session change.
  useEffect(() => {
    if (!wallet.sessionLoaded || !wallet.authenticated) return;
    // Deferred by a tick so the fetch starts after this render commits rather
    // than synchronously during the effect. Same pattern as SettingsExperience.
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, wallet.authenticated, wallet.sessionLoaded]);

  const toggle = async (enabled: boolean) => {
    if (view.phase !== "ready") return;
    setState({ ...view, enabled });
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory_enabled: enabled }) });
    setNotice(response.ok ? (enabled ? "Memory is on." : "Memory is off. Cabi will stop using saved details.") : "That couldn't be saved yet.");
  };

  const forget = async (id: string) => {
    const response = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (!response.ok) { setNotice("I couldn't forget that just now."); return; }
    setState((current) => current.phase === "ready" ? { ...current, memories: current.memories.filter((memory) => memory.id !== id) } : current);
    setNotice("Forgotten.");
  };

  const clearAll = async () => {
    if (!window.confirm("Forget every saved memory? Your conversations will stay.")) return;
    const response = await fetch("/api/memories", { method: "DELETE" });
    if (!response.ok) { setNotice("I couldn't clear those just now."); return; }
    setState((current) => current.phase === "ready" ? { ...current, memories: [] } : current);
    setNotice("All memories cleared.");
  };

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/cabi" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi profile">
            <ArrowLeft size={18} />
          </Link>
          <MiniCabi className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-.03em]">Memory</h1>
            <p className="mt-1 truncate text-sm text-[#777180]">What Cabi remembers about you.</p>
          </div>
          <WalletButton compact />
        </header>

        {view.phase === "loading" && (
          <div className="mt-8 space-y-3" aria-busy="true" aria-label="Loading memories">
            {[0, 1, 2].map((index) => <div key={index} className="h-20 animate-pulse rounded-[22px] border border-white/[0.06] bg-white/[0.02]" />)}
          </div>
        )}

        {view.phase === "disconnected" && (
          <section className="glass mt-10 rounded-[28px] p-7 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.06] text-violet-200"><Brain size={20} /></span>
            <h2 className="mt-5 text-xl font-semibold">Memory needs your wallet</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#a8a3b3]">
              Cabi only keeps memories for a signed-in wallet, so they belong to you and travel with you. Connect to see and manage them.
            </p>
            <button onClick={wallet.openConnect} className="focus-ring mt-6 h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#0b0912]">Connect Wallet</button>
          </section>
        )}

        {view.phase === "ready" && (
          <div className="mt-8 space-y-4">
            <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-[24px] p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Let Cabi remember</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-[#777180]">When this is off, she stops using saved details and stops saving new ones. Existing memories stay until you delete them.</p>
              </div>
              <Switch checked={view.enabled} onCheckedChange={(checked) => void toggle(checked)} aria-label="Enable memory" />
            </section>

            <section className="glass rounded-[24px] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">
                  {view.memories.length} {view.memories.length === 1 ? "memory" : "memories"}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => void load()} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
                    <RefreshCw size={12} /> Refresh
                  </button>
                  {view.memories.length > 0 && (
                    <button onClick={() => void clearAll()} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-300/[0.14] bg-rose-300/[0.05] px-3 text-[11px] font-semibold text-rose-200 hover:bg-rose-300/[0.09]">
                      <Trash2 size={12} /> Clear all
                    </button>
                  )}
                </div>
              </div>

              {view.memories.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] p-8 text-center">
                  <MiniCabi className="mx-auto h-12 w-12 opacity-70" decorative />
                  <p className="mt-3 text-sm text-[#8e889b]">Nothing saved yet.</p>
                  <p className="mt-1 text-xs text-[#625d6d]">Say &ldquo;remember that I like small-cap AI coins&rdquo; and it will show up here.</p>
                </div>
              ) : (
                <ul className="mt-4 space-y-2">
                  {view.memories.map((memory) => (
                    <li key={memory.id} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-violet-300">{memory.category}</p>
                        <p className="mt-1 break-words text-sm leading-6 text-[#d8d4df]">{memory.content}</p>
                        <p className="mt-1.5 text-[10px] text-[#5f5a67]">{new Date(memory.created_at).toLocaleDateString()}</p>
                      </div>
                      <button onClick={() => void forget(memory.id)} className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#706a7d] hover:bg-rose-300/[0.06] hover:text-rose-300" aria-label={`Forget: ${memory.content.slice(0, 40)}`}>
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="flex items-start gap-2 px-1 text-[11px] leading-5 text-[#625d6d]">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
              Cabi never saves wallet secrets, and she will not store something just because it was mentioned once. You can also say &ldquo;forget that I like X&rdquo; in chat.
            </p>

            {notice && <p role="status" className="px-1 text-xs text-violet-200">{notice}</p>}
          </div>
        )}
      </div>
    </main>
  );
}