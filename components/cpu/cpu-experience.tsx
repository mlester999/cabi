"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { PublicHeader } from "@/components/cabi/public-header";
import { CpuTokenCard } from "@/components/cpu/cpu-token-card";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Info, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";

export function CpuExperience({ prelaunch = false }: { prelaunch?: boolean } = {}) {
  const wallet = useWallet();
  const description = wallet.config.cpu.description || "Official information for Cat Partner Unit will be published here by the Cabi owner.";
  return (
    <div className="cabi-noise min-h-[100dvh] bg-transparent text-white">
      <PublicHeader active="cpu" />
      <main className="relative z-10 mx-auto w-full max-w-[1160px] px-5 py-12 sm:px-8 sm:py-20">
        <section className="grid items-center gap-12 lg:grid-cols-[minmax(300px,.9fr)_minmax(360px,1.1fr)] lg:gap-20">
          {/* `overflow-hidden` is required: the dashed ring rotates, and a
              rotating square's bounding box grows by ~41%, which escaped this
              fixed-width column and produced horizontal page scroll at 320px. */}
          <div className="relative mx-auto grid h-[300px] w-[300px] place-items-center overflow-hidden sm:h-[410px] sm:w-[410px]">
            <div className="absolute inset-[6%] rounded-full bg-violet-500/[0.14] blur-[72px]" />
            <div className="cabi-orbit absolute inset-[9%] rounded-full border border-dashed border-violet-300/[0.14]" />
            <div className="absolute inset-[24%] rounded-full border border-violet-300/[0.10] shadow-[0_0_80px_rgba(167,139,250,.12)]" />
            <MiniCabi className="cabi-breathe relative h-44 w-44 rounded-[48px] sm:h-56 sm:w-56" />
          </div>
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200/[0.12] bg-violet-200/[0.05] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.13em] text-violet-200"><Sparkles size={13} /> Cat Partner Unit</span>
            <h1 className="mt-6 text-[clamp(3.6rem,9vw,6.7rem)] font-semibold leading-none tracking-[-.07em]">${wallet.config.cpu.ticker || "CPU"}</h1>
            <p className="mx-auto mt-4 max-w-xl text-xl leading-8 text-[#a8a3b3] lg:mx-0">I&apos;m Cabi — your Cat Partner Unit.</p>
            <div className="mx-auto mt-8 max-w-xl text-left lg:mx-0"><CpuTokenCard /></div>
          </div>
        </section>

        <section className="mt-20 grid gap-6 border-t border-white/[0.06] pt-12 md:grid-cols-2 lg:mt-28 lg:gap-12">
          <article className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Info size={18} className="text-violet-300" /> What is CPU?</h2><p className="mt-4 text-sm leading-7 text-[#a8a3b3]">{description}</p></article>
          <article className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles size={18} className="text-violet-300" /> About Cabi</h2><p className="mt-4 text-sm leading-7 text-[#a8a3b3]">Cabi is a warm AI companion. Wallet sign-in is optional for chatting and only unlocks saved conversations, memories, settings, and bond continuity.</p>{prelaunch ? <><p className="mt-4 rounded-2xl border border-violet-200/[0.12] bg-violet-300/[0.05] px-4 py-3 text-xs leading-5 text-violet-100">Cabi is still getting ready. The full application opens on this domain when the owner launches it.</p><Link href="/" className="focus-ring mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0b0912] hover:bg-violet-100"><MessageCircleMore size={15} /> See what Cabi is working on</Link></> : <Link href="/" className="focus-ring mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#0b0912] hover:bg-violet-100"><MessageCircleMore size={15} /> Chat with Cabi</Link>}</article>
        </section>
      </main>
    </div>
  );
}
