import "server-only";

import { jsonError } from "@/lib/security/request";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode, siteModeAllowsApp } from "@/lib/site/mode";
import { readOwnerPreviewAuth } from "@/lib/site/owner-preview";
import { isPreviewActive } from "@/lib/site/preview";
import { readWalletAuth } from "@/lib/wallet/session";
import {
  resolveCabiAccessForSession,
  type CabiAccess,
  type CabiViewerKind,
  type CpuGateStatus,
  type RuntimeCabiAccess,
} from "@/lib/cpu-access/resolve";
import type { SiteMode } from "@/lib/site/mode-shared";
import type { WalletAuthIdentity } from "@/lib/wallet/auth";

export {
  adminOnlyPaths,
  alwaysPublicApiRoutePrefixes,
  appApiRoutePrefixes,
  appPagePaths,
  isAlwaysPublicApiPath,
  isGatedAppApiPath,
  matchesRoutePrefix,
} from "@/lib/site/guard-config";

export type ViewerKind = CabiViewerKind;

export type AppAccess = {
  /** The application UI and its APIs may be used. */
  allowed: boolean;
  /** Why access was granted, for building the preview chrome. */
  viewer: ViewerKind;
  /** True when the site is in its normal public LIVE state. */
  live: boolean;
  /** True when an unlocked admin is looking at a non-public site mode. */
  previewing: boolean;
  /** True only when an approved owner/admin wallet skipped the $CPU requirement. */
  cpuGateBypassed: boolean;
  /** The full decision, including the holder-gate detail. */
  decision: CabiAccess;
};

/** The dependencies the access rules run against, so the rules stay testable. */
export type AppAccessDependencies = {
  mode: SiteMode;
  fresh?: boolean;
  readAdminSession: () => Promise<{ email: string } | null>;
  isPreviewActive: () => Promise<boolean>;
  readOwnerPreviewAuth: () => Promise<Pick<WalletAuthIdentity, "walletAddress" | "walletAddressUniqueKey"> | null>;
  /** LIVE only: the verified wallet session, or null. */
  readWalletAuth: () => Promise<Pick<WalletAuthIdentity, "walletAddress" | "walletAddressUniqueKey"> | null>;
  /** LIVE only: resolves the holder gate, including the trusted balance read. */
  resolveCpuAccess: (session: Pick<WalletAuthIdentity, "walletAddress" | "walletAddressUniqueKey"> | null) => Promise<RuntimeCabiAccess>;
};

function previewAccess(): AppAccess {
  return {
    allowed: true,
    viewer: "preview",
    live: false,
    previewing: true,
    cpuGateBypassed: false,
    decision: { allowed: true, reason: "ALLOWED", live: false, previewing: true, viewer: "preview", cpuGateBypassed: false },
  };
}

/**
 * The authorization rules themselves, expressed against explicit dependencies.
 *
 * Two independent layers, evaluated in this order:
 *
 * 1. Site mode. Outside LIVE only an explicit admin preview opt-in, or a
 *    verified allowlisted owner wallet with a matching preview credential, gets
 *    in. Holding $CPU never bypasses PRELAUNCH.
 * 2. The $CPU holder gate. While LIVE, a normal wallet must prove ownership with
 *    a signature and hold at least the configured minimum of $CPU, read from the
 *    official contract by the server. Approved owner/admin wallets are exempt.
 */
export async function resolveAppAccess(dependencies: AppAccessDependencies): Promise<AppAccess> {
  const { mode } = dependencies;
  if (siteModeAllowsApp(mode)) {
    const wallet = await dependencies.readWalletAuth();
    const decision = await dependencies.resolveCpuAccess(wallet);
    return {
      allowed: decision.allowed,
      viewer: decision.viewer,
      live: decision.live,
      previewing: decision.previewing,
      cpuGateBypassed: decision.allowed ? decision.cpuGateBypassed : false,
      decision,
    };
  }

  // Preview is only meaningful outside LIVE, so these reads are skipped entirely
  // on the public happy path.
  const session = await dependencies.readAdminSession().catch(() => null);
  if (session && await dependencies.isPreviewActive().catch(() => false)) return previewAccess();
  if (mode === "PRELAUNCH" && await dependencies.readOwnerPreviewAuth().catch(() => null)) return previewAccess();

  const decision = await resolveCabiAccessForSession(null, { mode });
  return {
    allowed: false,
    viewer: session ? "admin" : "visitor",
    live: false,
    previewing: false,
    cpuGateBypassed: false,
    decision,
  };
}

/**
 * Single source of truth for "may this request reach the Cabi application?".
 *
 * This runs on the server for pages, layouts, and route handlers. The UI only
 * ever reflects it, and no forged client value can reach it: identity comes from
 * the signed HttpOnly session cookie and the balance from a trusted RPC read.
 */
export async function getAppAccess(options: { fresh?: boolean } = {}): Promise<AppAccess> {
  const { mode } = await getSiteMode();
  return resolveAppAccess({
    mode,
    fresh: options.fresh,
    readAdminSession: () => readAdminSession(),
    isPreviewActive: () => isPreviewActive(),
    readOwnerPreviewAuth: () => readOwnerPreviewAuth(),
    readWalletAuth: () => readWalletAuth(),
    resolveCpuAccess: (session) => resolveCabiAccessForSession(session, { mode, fresh: options.fresh }),
  });
}

/** A protected surface this request may not use, plus the reason to show. */
export type AppAccessBlock = {
  kind: "PRELAUNCH" | "WALLET_REQUIRED" | "CPU_GATE_REQUIRED" | "CPU_CHECK_FAILED";
  status: number;
  code: string;
  message: string;
  gate: CpuGateStatus | null;
};

const prelaunchBlock: AppAccessBlock = {
  kind: "PRELAUNCH",
  status: 404,
  code: "SITE_PRELAUNCH",
  message: "This part of Cabi isn't open yet.",
  gate: null,
};

/** Maps a decision to a block, or null when the request may continue. */
export function blockForAccess(access: AppAccess): AppAccessBlock | null {
  if (access.allowed) return null;
  const decision = access.decision;
  if (!decision.allowed) {
    if (decision.reason === "NOT_AUTHENTICATED") {
      // While LIVE the application is holder-only, so an unsigned visitor is told
      // to connect rather than shown the prelaunch story.
      return { kind: "WALLET_REQUIRED", status: 401, code: "WALLET_UNAUTHORIZED", message: "Connect and sign in with your wallet to continue.", gate: null };
    }
    if (decision.reason === "INSUFFICIENT_CPU" || decision.reason === "CPU_CHECK_FAILED") {
      return {
        kind: decision.reason === "INSUFFICIENT_CPU" ? "CPU_GATE_REQUIRED" : "CPU_CHECK_FAILED",
        status: 403,
        code: decision.reason,
        message: decision.gate.message,
        gate: decision.gate,
      };
    }
  }
  return prelaunchBlock;
}

function blockResponse(block: AppAccessBlock | null): Response | null {
  if (!block) return null;
  if (block.kind === "PRELAUNCH") return jsonError(block.message, block.status, block.code);
  if (block.kind === "WALLET_REQUIRED") return jsonError(block.message, block.status, block.code);
  return Response.json(
    { error: block.message, code: block.code, cpuGate: block.gate },
    { status: block.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Guard for route handlers that expose unfinished public functionality.
 *
 * Returns `null` when the request may continue, a `404` that deliberately
 * matches the public story while the site is in PRELAUNCH, or a `403` carrying
 * the holder-gate detail when an authenticated wallet does not meet the $CPU
 * requirement.
 */
export async function guardAppApi(): Promise<Response | null> {
  return blockResponse(blockForAccess(await getAppAccess()));
}

/** Guard for a server-rendered application page. Same rules, page-shaped result. */
export async function guardAppPage(): Promise<AppAccessBlock | null> {
  return blockForAccess(await getAppAccess());
}

/**
 * Guard for a Cabi core API: the site mode first, then the $CPU holder gate.
 *
 * While the site is in PRELAUNCH this returns `null` without touching the
 * holder gate, which keeps the prelaunch fast path unchanged and preserves the
 * rule that holding $CPU never bypasses prelaunch. While LIVE it requires an
 * authenticated wallet that either holds enough $CPU or is an approved admin.
 *
 * Expensive actions (chat, image generation) pass `fresh` so the decision never
 * rests on a cached balance, which is also what locks out a long-lived session
 * as soon as the wallet drops below the minimum.
 *
 * Returns `null` when the request may continue, a `404` that matches the public
 * prelaunch story, or a `403` carrying the holder-gate detail.
 */
export async function guardAppApiCpu(options: { fresh?: boolean } = {}): Promise<Response | null> {
  const { mode } = await getSiteMode();
  if (mode !== "LIVE") return guardAppApi();
  return blockResponse(blockForAccess(await getAppAccess({ fresh: options.fresh })));
}

/**
 * Re-checks eligibility while ignoring the short cache. This is what
 * "Check Again" and expensive protected actions use, so a wallet that dropped
 * below the minimum is locked out on its next check rather than at the end of a
 * cache window.
 */
export async function guardAppApiFresh(): Promise<Response | null> {
  return blockResponse(blockForAccess(await getAppAccess({ fresh: true })));
}

export async function guardAppPageFresh(): Promise<AppAccessBlock | null> {
  return blockForAccess(await getAppAccess({ fresh: true }));
}
