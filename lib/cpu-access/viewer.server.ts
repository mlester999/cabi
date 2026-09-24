import "server-only";

import { readCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { getSiteMode } from "@/lib/site/mode";
import { isAuthorizedOwnerWallet } from "@/lib/site/owner-wallets";
import { readWalletAuth } from "@/lib/wallet/session";

/**
 * Whether the viewer is an approved owner/admin wallet whose $CPU requirement
 * was skipped.
 *
 * The decision is made here, on the server, from the verified session and the
 * database allowlist. It is only ever used to render an "ADMIN ACCESS" badge, so
 * it deliberately re-derives the same facts the authorization path uses rather
 * than trusting anything the browser sends.
 */
export async function isCpuGateBypassedForViewer(): Promise<boolean> {
  try {
    const [{ mode }, { settings }] = await Promise.all([getSiteMode(), readCpuAccessGateSettings()]);
    if (mode !== "LIVE" || !settings.enabled || !settings.allowAdminBypass) return false;
    const wallet = await readWalletAuth();
    if (!wallet) return false;
    return await isAuthorizedOwnerWallet(wallet.walletAddress).catch(() => false);
  } catch {
    return false;
  }
}
