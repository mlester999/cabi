import { CabiCharacter } from "@/components/prelaunch/cabi-character";
import { PrelaunchHeader } from "@/components/prelaunch/prelaunch-header";
import { PrelaunchVeil } from "@/components/prelaunch/prelaunch-veil";
import { CabiMascotSpot, CabiTerminal, SystemStatus } from "@/components/prelaunch/system-status";
import { CupStage } from "@/components/prelaunch/cpu-stage";
import { FeaturePreview } from "@/components/prelaunch/feature-preview";
import { Reveal } from "@/components/prelaunch/reveal";
import type { PrelaunchSettings } from "@/lib/site/prelaunch";
import type { PublicWalletConfig } from "@/lib/wallet/config";

/**
 * Rotating status lines. Playful and non-committal: none of them promise a
 * release time, and the owner's own status text always takes the first slot.
 */
export const statusRotation = [
  "Teaching Cabi new tricks...",
  "Building her memory...",
  "Connecting the wires...",
  "Securing wallet sign-in...",
  "Learning Clank.trade...",
  "Getting her room ready...",
  "Almost ready to meet you.",
] as const;

/**
 * The public prelaunch experience.
 *
 * Desktop: brand, headline, live status, and feature preview on the left, with
 * Cabi herself taking the right half. Mobile keeps its own order — brand,
 * character, headline, status, description, chips, $CPU, social — rather than
 * compressing the desktop grid.
 */
export function PrelaunchExperience({
  settings,
  wallet,
  preview,
}: {
  settings: PrelaunchSettings;
  wallet: PublicWalletConfig;
  preview?: React.ReactNode;
}) {
  const ticker = wallet.cpu.ticker || "CPU";
  const rotation = [settings.subheadline, ...statusRotation];

  return (
    <div className="cabi-prelaunch cabi-noise relative min-h-[100dvh] overflow-x-hidden bg-transparent text-white">
      <div className="cabi-atmosphere" aria-hidden="true" />
      <div className="cabi-grain" aria-hidden="true" />
      <PrelaunchVeil />

      {preview ? <div className="relative z-40">{preview}</div> : null}

      <PrelaunchHeader
        ticker={ticker}
        xUrl={settings.xUrl}
        communityUrl={settings.communityUrl}
        showSocial={settings.showSocial}
      />

      {settings.announcement ? (
        <Reveal className="relative z-30 mx-auto mt-5 w-full max-w-[1240px] px-5 sm:px-8">
          <p className="rounded-2xl border border-violet-200/[0.13] bg-violet-300/[0.05] px-4 py-3 text-center text-[13px] leading-6 text-violet-100">
            {settings.announcement}
          </p>
        </Reveal>
      ) : null}

      <main className="relative z-20 mx-auto w-full max-w-[1240px] px-5 pb-16 sm:px-8">
        <div className="grid items-start gap-10 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,.98fr)] lg:gap-14 lg:pt-14">
          {/* Mobile shows Cabi first; desktop places her on the right. */}
          <div className="order-1 lg:hidden">
            <Reveal y={16}>
              <CabiCharacter className="mx-auto h-[320px] w-full max-w-[420px] sm:h-[420px]" />
            </Reveal>
          </div>

          <div className="order-2 min-w-0">
            <Reveal>
              <p className="text-[11px] font-semibold uppercase tracking-[.28em] text-violet-300/80">
                {settings.statusLabel || "CABI SYSTEM"}
              </p>
              <h1 className="mt-4 text-balance text-[clamp(2.15rem,7.4vw,3.9rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
                {settings.headline}
              </h1>
              <p className="mt-4 max-w-[38rem] text-pretty text-[15px] leading-7 text-[#b9b3c6] sm:text-[17px] sm:leading-8">
                {settings.subheadline}
              </p>
            </Reveal>

            <Reveal delay={0.06} className="mt-7">
              <SystemStatus statusLabel={settings.statusLabel || "CABI SYSTEM"} rotation={rotation} />
            </Reveal>

            <Reveal delay={0.12} className="mt-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
                <p className="glass min-w-0 flex-1 rounded-[26px] p-4 text-[13px] leading-6 text-[#b9b3c6] sm:p-5 sm:text-sm sm:leading-7">
                  {settings.description}
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.16} className="mt-5">
              <CabiMascotSpot />
            </Reveal>

            <Reveal delay={0.2} className="mt-5">
              <CabiTerminal />
            </Reveal>
          </div>

          <div className="order-3 hidden lg:block">
            <Reveal y={16}>
              <CabiCharacter className="ml-auto h-[clamp(430px,60vh,660px)] w-full max-w-[600px]" />
              <p className="mt-1 text-center text-[11px] uppercase tracking-[.3em] text-[#4f4a5c]">
                Cat Partner Unit · ${ticker}
              </p>
            </Reveal>
          </div>
        </div>

        <Reveal className="mt-14 sm:mt-20">
          <FeaturePreview chips={settings.featureChips} />
        </Reveal>

        {settings.showCpu ? (
          <Reveal className="mt-10 sm:mt-14">
            <CupStage settings={settings} wallet={wallet} />
          </Reveal>
        ) : null}
      </main>

      <footer className="relative z-20 mx-auto w-full max-w-[1240px] px-5 pb-10 sm:px-8">
        <div className="cabi-hairline cabi-hairline-breathe" aria-hidden="true" />
        <div className="mt-5 flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-[11px] uppercase tracking-[.22em] text-[#4f4a5c]">Cabi · Cat Partner Unit</p>
          <p className="text-[11px] text-[#4f4a5c]">Cabi is still learning. Nothing here is financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
