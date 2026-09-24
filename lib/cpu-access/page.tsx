import "server-only";

import type { ReactNode } from "react";

import { CpuHolderGate, CpuSignedOutGate, type CpuGateView } from "@/components/cpu/cpu-access-gate";
import { cpuBuyUrlFor } from "@/lib/cpu-access/config";
import { cpuAccessUnverifiedMessage, type CpuGateStatus } from "@/lib/cpu-access/resolve";
import { readCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { isCpuGateBypassedForViewer } from "@/lib/cpu-access/viewer.server";
import { guardAppPage } from "@/lib/site/guard";

/**
 * Page-level enforcement of the $CPU holder gate.
 *
 * Every protected server-rendered page calls this. It performs the same
 * `guardAppPage()` decision the APIs use - there is no page-only rule - and
 * returns either the application element, or the holder gate element to render
 * *instead* of it. Because the choice happens during server rendering, the
 * application markup is never sent to a wallet that does not qualify, and a
 * direct navigation to a protected path cannot skip it.
 */

export type CpuGatedPage = {
  /** The application element when allowed, the gate element when blocked, else null. */
  element: ReactNode;
  /** True when the application was rendered. */
  allowed: boolean;
  /** True when the holder gate was rendered instead. */
  gated: boolean;
  /** True when the viewer is an approved owner/admin with the gate bypassed. */
  bypassed: boolean;
};

function viewFromGate(gate: CpuGateStatus, minimumBalance: number): CpuGateView {
  return {
    walletAddress: gate.walletAddress,
    required: gate.numbers?.required ?? minimumBalance.toLocaleString("en-US"),
    minimumBalance,
    balance: gate.numbers?.balance ?? null,
    deficit: gate.numbers?.deficit ?? null,
    symbol: gate.numbers?.symbol ?? "CPU",
    // The server decided which variant this is; the component only renders it.
    reason: gate.reason,
    message: gate.message ?? cpuAccessUnverifiedMessage,
    buyUrl: gate.buyUrl,
  };
}

function signedOutView(required: string, minimumBalance: number, buyUrl: string | null): CpuGateView {
  return {
    walletAddress: null,
    required,
    minimumBalance,
    balance: null,
    deficit: null,
    symbol: "CPU",
    reason: "INSUFFICIENT_CPU",
    message: null,
    buyUrl,
  };
}

/**
 * Wraps a protected page.
 *
 * `render` receives whether an approved owner/admin wallet had the requirement
 * bypassed, for owner-only chrome such as the "ADMIN ACCESS" badge.
 *
 * Three outcomes:
 *
 * - allowed: the page's own content is returned.
 * - the holder gate blocks: the holder panel is returned *instead* of the page.
 * - PRELAUNCH / MAINTENANCE: `element` is null and `gated` is false, so the
 *   caller's existing non-LIVE branch runs unchanged.
 */
export async function cpuGatedPage(render: (bypassed: boolean) => ReactNode): Promise<CpuGatedPage> {
  const block = await guardAppPage();
  if (!block) {
    const bypassed = await isCpuGateBypassedForViewer();
    return { element: render(bypassed), allowed: true, gated: false, bypassed };
  }
  if (block.kind === "PRELAUNCH") {
    // The site-mode layer is not something the gate can fix; the caller decides.
    return { element: null, allowed: false, gated: false, bypassed: false };
  }

  const { settings } = await readCpuAccessGateSettings();
  const buyUrl = cpuBuyUrlFor(settings.buyUrl);
  const required = settings.minimumBalance.toLocaleString("en-US");
  // A signed-out visitor is shown the connection step; a signed-in wallet that
  // is short (or whose balance could not be read) is shown its own numbers.
  const element = block.gate?.walletAddress
    ? <CpuHolderGate initial={viewFromGate(block.gate, settings.minimumBalance)} fallbackBuyUrl={buyUrl} />
    : (
      <CpuSignedOutGate
        required={required}
        minimumBalance={settings.minimumBalance}
        buyUrl={buyUrl}
        initial={{ view: signedOutView(required, settings.minimumBalance, buyUrl) }}
      />
    );
  return { element, allowed: false, gated: true, bypassed: false };
}
