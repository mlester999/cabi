"use client";

import { ArrowLeft, Heart, MessageCircleMore, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { CabiCharacter } from "@/components/prelaunch/cabi-character";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { moodFor, type CabiMood } from "@/lib/cabi/mood";

type BondProfile = {
  points: number;
  level: number;
  label: string;
  progress: number;
  pointsToNextLevel: number;
  conversationDays: number;
  conversationCount: number;
  memoryCount: number;
  firstSeenAt: string | null;
  lastInteractionAt: string | null;
};

type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "ready"; profile: BondProfile; mood: CabiMood };

const levelLadder = [
  "Stranger", "New Friend", "Familiar", "Buddy", "Trusted Human",
  "Favorite Human", "Close Companion", "Partner", "Best Partner", "Forever CPU",
] as const;

function daysSince(value: string | null) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * Cabi's profile: who she is, how she is feeling, and where the two of you are.
 *
 * Bond progress is shown honestly - it reflects real conversation days, never
 * purchases, holdings, or absence. There is no streak guilt and no daily push.
 */
export function CabiProfileExperience() {
  const wallet = useWallet();
  const [state, setState] = useState<State>({ phase: "loading" });
  // Derived, not stored: a signed-out visitor is disconnected regardless of what
  // any in-flight request returned.
  const view: State = wallet.sessionLoaded && !wallet.authenticated ? { phase: "disconnected" } : state;

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const hour = new Date().getHours();
      const response = await fetch(`/api/cabi?hour=${hour}`, { cache: "no-store" });
      const payload = await response.json() as { connected?: boolean; profile?: BondProfile; mood?: CabiMood };
      if (!payload.connected || !payload.profile) { setState({ phase: "disconnected" }); return; }
      setState({ phase: "ready", profile: payload.profile, mood: payload.mood ?? "cozy" });
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

  const mood = view.phase === "ready" ? moodFor(view.mood) : moodFor("cozy");
  const profile = view.phase === "ready" ? view.profile : null;
  const days = daysSince(profile?.firstSeenAt ?? null);

  return (
    <main className="cabi-noise min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-7 sm:py-9">
        <header className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#a8a3b3] hover:text-white" aria-label="Back to Cabi">
            <ArrowLeft size={18} />
          </Link>
          <MiniCabi className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-.03em]">Cabi</h1>
            <p className="mt-1 truncate text-sm text-[#777180]">Cat Partner Unit</p>
          </div>
          <WalletButton compact />
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="glass relative overflow-hidden rounded-[28px] p-5">
            <CabiCharacter className="mx-auto h-[300px] w-full max-w-[380px] sm:h-[360px]" mood={mood.mood} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Mood</p>
                <p className="mt-1 text-lg font-semibold" style={{ color: mood.accent }}>{mood.label}</p>
              </div>
              <p className="max-w-[16rem] text-right text-[12px] leading-5 text-[#a8a3b3]">{mood.status}</p>
            </div>
          </section>

          <div className="space-y-5">
            {view.phase === "loading" && (
              <div className="space-y-3" aria-busy="true" aria-label="Loading Cabi profile">
                {[0, 1, 2].map((index) => <div key={index} className="h-28 animate-pulse rounded-[26px] border border-white/[0.06] bg-white/[0.02]" />)}
              </div>
            )}

            {view.phase === "disconnected" && (
              <section className="glass rounded-[28px] p-7">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.06] text-violet-200"><Heart size={20} /></span>
                <h2 className="mt-5 text-xl font-semibold">Want me to remember you?</h2>
                <p className="mt-3 text-sm leading-7 text-[#a8a3b3]">
                  Connect and sign in with an EVM wallet and I can keep our bond, your memories, and your chats together. Signing in is free and sends no transaction.
                </p>
                <button onClick={wallet.openConnect} className="focus-ring mt-6 h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#0b0912]">Connect Wallet</button>
              </section>
            )}

            {profile && (
              <>
                <section className="glass rounded-[28px] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Bond level {profile.level}</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-.03em]">{profile.label}</h2>
                    </div>
                    <Heart size={20} className="text-violet-300" fill="currentColor" aria-hidden="true" />
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-300 via-violet-400 to-violet-500 shadow-[0_0_16px_rgba(167,139,250,.7)] transition-[width] duration-700" style={{ width: `${profile.progress}%` }} role="progressbar" aria-valuenow={profile.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Bond progress" />
                  </div>
                  <p className="mt-3 text-xs text-[#8e889b]">
                    {profile.level >= 10
                      ? "You two are as close as it gets."
                      : `${profile.pointsToNextLevel} more to reach ${levelLadder[profile.level] ?? "the next level"}.`}
                  </p>
                </section>

                <section className="glass rounded-[28px] p-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Together</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <Stat label="Days since we met" value={days == null ? "?" : String(days)} />
                    <Stat label="Days we talked" value={String(profile.conversationDays)} />
                    <Stat label="Conversations" value={String(profile.conversationCount)} />
                    <Stat label="Memories" value={String(profile.memoryCount)} />
                  </dl>
                  <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-[#777180]">
                    <Sparkles size={13} className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
                    Bond grows from talking, not from buying, holding, or trading anything. Missing a day never costs you anything.
                  </p>
                </section>

                <div className="flex flex-wrap gap-2">
                  <Link href="/settings/memory" className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
                    <Sparkles size={15} /> {profile.memoryCount} {profile.memoryCount === 1 ? "memory" : "memories"}
                  </Link>
                  <Link href="/" className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] hover:brightness-105">
                    <MessageCircleMore size={15} /> Talk to Cabi
                  </Link>
                  <button onClick={() => void load()} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-semibold text-[#d5d0de] hover:bg-white/[0.06]">
                    <RefreshCw size={15} /> Refresh
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <dt className="text-[10px] uppercase tracking-[.14em] text-[#6f6a7d]">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tracking-[-.03em]">{value}</dd>
    </div>
  );
}