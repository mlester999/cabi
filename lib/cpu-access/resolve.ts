import "server-only";

import { cpuBuyUrlFor } from "@/lib/cpu-access/config";
import { readCpuAccessBalance, type CpuBalanceCheck } from "@/lib/cpu-access/balance.server";
import { formatAmount, formatWholeAmount } from "@/lib/cpu-access/format";
import { readCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { isAuthorizedOwnerWallet } from "@/lib/site/owner-wallets";
import type { SiteMode } from "@/lib/site/mode-shared";
import type { WalletAuthIdentity } from "@/lib/wallet/auth";

/**
 * The canonical Cabi authorization decision.
 *
 * One function answers "may this request use the Cabi application?" for pages,
 * route handlers, and the client status endpoint, so the rules cannot drift
 * between surfaces. It is server-only and reads the wallet session, the site
 * mode, the owner/admin allowlist, and the $CPU balance itself.
 *
 * Decision order:
 *
 *   1. Site not LIVE  -> an authorized owner/admin preview, otherwise PRELAUNCH.
 *   2. Not authenticated -> NOT_AUTHENTICATED.
 *   3. Verified admin/owner wallet -> ADMIN_BYPASS (no holding requirement).
 *   4. Gate switched off server-side -> ALLOWED.
 *   5. Read $CPU balance server-side -> ALLOWED, INSUFFICIENT_CPU, or
 *      CPU_CHECK_FAILED (which always fails closed).
 *
 * Nothing here can be influenced by a request body, a query parameter, a header,
 * React state, or local storage: the wallet identity comes from the signed
 * HttpOnly session cookie and the balance comes from a trusted RPC read.
 */

export type CabiAccessReason =
  | "ALLOWED"
  | "PRELAUNCH"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_CPU"
  | "CPU_CHECK_FAILED"
  | "ADMIN_BYPASS";

export type CabiViewerKind = "visitor" | "admin" | "preview";

/** Display-ready numbers. Authorization always uses the raw bigint behind them. */
export type CpuGateNumbers = {
  symbol: string;
  decimals: number;
  /** Whole $CPU the wallet holds, truncated for display (never rounded up). */
  balance: string;
  /** True when the exact balance has more precision than `balance` shows. */
  balanceTruncated: boolean;
  /** Whole $CPU required, as stated by the product ("1,000,000"). */
  required: string;
  /** Whole $CPU still needed, exact and truncated for display. */
  deficit: string;
};

export type CpuGateStatus = {
  reason: "INSUFFICIENT_CPU" | "CPU_CHECK_FAILED";
  walletAddress: string;
  numbers: CpuGateNumbers | null;
  buyUrl: string | null;
  /** Controlled copy the UI renders verbatim; never a raw RPC or provider error. */
  message: string;
};

export type CabiAccess =
  | { allowed: true; reason: "ALLOWED" | "ADMIN_BYPASS"; live: boolean; previewing: boolean; viewer: CabiViewerKind; cpuGateBypassed: boolean }
  | { allowed: false; reason: "PRELAUNCH" | "NOT_AUTHENTICATED"; live: boolean; previewing: false; viewer: CabiViewerKind; cpuGateBypassed: false }
  | { allowed: false; reason: "INSUFFICIENT_CPU" | "CPU_CHECK_FAILED"; live: boolean; previewing: false; viewer: CabiViewerKind; cpuGateBypassed: false; gate: CpuGateStatus };

export type ResolveCabiAccessInput = {
  mode: SiteMode;
  /** Verified wallet identity, or null for a visitor. */
  session: Pick<WalletAuthIdentity, "walletAddress" | "walletAddressUniqueKey"> | null;
  /** `cpu_holder_gate_enabled` resolved server-side. */
  gateEnabled: boolean;
  /** Balances read through `readCpuAccessBalance`, or null when not attempted. */
  balance?: CpuBalanceCheck | null;
  /** Wallet address to read the balance for. */
  walletAddress?: string | null;
  /** Whether approved owner/admin wallets skip the gate. */
  allowAdminBypass?: boolean;
  /** Whether this wallet is on the server-side owner/admin allowlist. */
  isAdmin?: boolean;
  /** The verified official Clank.trade coin page, or null when unavailable. */
  buyUrl?: string | null;
};

export const cpuAccessRequiredMessage = "You need 1,000,000 $CPU to enter.";
export const cpuAccessUnverifiedMessage = "Cabi couldn't verify your $CPU balance right now.";

/**
 * The pure decision. Deliberately synchronous and side-effect free so the whole
 * matrix can be tested without a database, an RPC, or a browser.
 */
export function resolveCabiAccess(input: ResolveCabiAccessInput): CabiAccess {
  const live = input.mode === "LIVE";

  if (!live) {
    // PRELAUNCH and MAINTENANCE are a separate authorization layer that runs
    // BEFORE the holder gate. Holding $CPU never bypasses prelaunch; only an
    // approved admin/owner preview does.
    return { allowed: false, reason: "PRELAUNCH", live: false, previewing: false, viewer: "visitor", cpuGateBypassed: false };
  }

  const session = input.session;
  if (!session) {
    return { allowed: false, reason: "NOT_AUTHENTICATED", live: true, previewing: false, viewer: "visitor", cpuGateBypassed: false };
  }

  const walletAddress = input.walletAddress ?? session.walletAddress;
  const allowBypass = input.allowAdminBypass !== false;
  if (allowBypass && input.isAdmin) {
    return { allowed: true, reason: "ADMIN_BYPASS", live: true, previewing: false, viewer: "visitor", cpuGateBypassed: true };
  }

  if (!input.gateEnabled) {
    return { allowed: true, reason: "ALLOWED", live: true, previewing: false, viewer: "visitor", cpuGateBypassed: false };
  }

  const balance = input.balance ?? null;
  if (!balance) {
    return {
      allowed: false,
      reason: "CPU_CHECK_FAILED",
      live: true,
      previewing: false,
      viewer: "visitor",
      cpuGateBypassed: false,
      gate: { reason: "CPU_CHECK_FAILED", walletAddress, numbers: null, buyUrl: input.buyUrl ?? null, message: cpuAccessUnverifiedMessage },
    };
  }

  const numbers: CpuGateNumbers = displayNumbersFor(balance);

  if (balance.meetsMinimum) {
    return { allowed: true, reason: "ALLOWED", live: true, previewing: false, viewer: "visitor", cpuGateBypassed: false };
  }

  return {
    allowed: false,
    reason: "INSUFFICIENT_CPU",
    live: true,
    previewing: false,
    viewer: "visitor",
    cpuGateBypassed: false,
    gate: { reason: "INSUFFICIENT_CPU", walletAddress, numbers, buyUrl: input.buyUrl ?? null, message: cpuAccessRequiredMessage },
  };
}

/** True when the UI should show a $CPU holder modal / page for this decision. */
export function isCpuGateBlocked(access: CabiAccess): access is Extract<CabiAccess, { reason: "INSUFFICIENT_CPU" | "CPU_CHECK_FAILED" }> {
  return !access.allowed && (access.reason === "INSUFFICIENT_CPU" || access.reason === "CPU_CHECK_FAILED");
}

/**
 * Display-ready numbers derived from a trusted balance check.
 *
 * Exported so the exact same conversion is used by every surface that shows the
 * gate, and so it can be tested directly. The raw bigint stays on the server.
 */
export function displayNumbersFor(balance: Pick<CpuBalanceCheck, "symbol" | "decimals" | "raw" | "deficitRaw" | "minimum">): CpuGateNumbers {
  const shown = formatAmount(balance.raw, balance.decimals);
  return {
    symbol: balance.symbol,
    decimals: balance.decimals,
    // Truncated toward zero, never rounded up: the gate must not tell a holder
    // they have more than they do.
    balance: shown.text,
    balanceTruncated: shown.truncated,
    required: formatWholeAmount(balance.minimum),
    deficit: formatAmount(balance.deficitRaw, balance.decimals).text,
  };
}

export type RuntimeCabiAccess = CabiAccess & { settings: { minimumBalance: number; gateEnabled: boolean; allowAdminBypass: boolean } };

/**
 * Resolves access for the current request, including the trusted $CPU read.
 *
 * `fresh` bypasses the short balance cache, which is what "Check Again" uses so
 * the user is never shown a stale answer after they act.
 */
export async function resolveCabiAccessForSession(
  session: Pick<WalletAuthIdentity, "walletAddress" | "walletAddressUniqueKey"> | null,
  options: { mode: SiteMode; fresh?: boolean },
): Promise<RuntimeCabiAccess> {
  const { settings } = await readCpuAccessGateSettings({ fresh: options.fresh });
  const buyUrl = cpuBuyUrlFor(settings.buyUrl);

  if (options.mode !== "LIVE") {
    return { ...resolveCabiAccess({ mode: options.mode, session, gateEnabled: settings.enabled, buyUrl }), settings: { minimumBalance: settings.minimumBalance, gateEnabled: settings.enabled, allowAdminBypass: settings.allowAdminBypass } };
  }

  // An unauthenticated visitor never triggers an onchain read.
  if (!session) {
    return { ...resolveCabiAccess({ mode: options.mode, session, gateEnabled: settings.enabled, buyUrl }), settings: { minimumBalance: settings.minimumBalance, gateEnabled: settings.enabled, allowAdminBypass: settings.allowAdminBypass } };
  }

  // The allowlist is consulted only when the bypass is enabled, and only for a
  // wallet whose ownership was already proven by a signature.
  const isAdmin = settings.allowAdminBypass
    ? await isAuthorizedOwnerWallet(session.walletAddress).catch(() => false)
    : false;
  if (isAdmin) {
    return { ...resolveCabiAccess({ mode: options.mode, session, gateEnabled: settings.enabled, isAdmin, allowAdminBypass: settings.allowAdminBypass, buyUrl }), settings: { minimumBalance: settings.minimumBalance, gateEnabled: settings.enabled, allowAdminBypass: settings.allowAdminBypass } };
  }

  // A disabled gate still needs the wallet to be authenticated, but no RPC read.
  if (!settings.enabled) {
    return { ...resolveCabiAccess({ mode: options.mode, session, gateEnabled: false, allowAdminBypass: settings.allowAdminBypass, buyUrl }), settings: { minimumBalance: settings.minimumBalance, gateEnabled: false, allowAdminBypass: settings.allowAdminBypass } };
  }

  const balance = await readCpuAccessBalance({
    address: session.walletAddress,
    fresh: options.fresh,
    config: {
      contract: settings.contract,
      chainId: settings.chainId,
      rpcUrl: settings.rpcUrl,
      minimum: settings.minimumBalance,
      fallbackSymbol: "CPU",
    },
  });

  const access = resolveCabiAccess({
    mode: options.mode,
    session,
    gateEnabled: true,
    isAdmin: false,
    allowAdminBypass: settings.allowAdminBypass,
    balance: balance.ok ? balance.data : null,
    buyUrl,
  });
  return { ...access, settings: { minimumBalance: settings.minimumBalance, gateEnabled: true, allowAdminBypass: settings.allowAdminBypass } };
}
