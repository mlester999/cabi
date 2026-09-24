"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { useWallet } from "@/components/wallet/wallet-provider";
import { cpuGateBlockedEvent, announceCpuHolderStatusChanged } from "@/lib/cpu-access/events";
import { walletAuthenticatedEvent } from "@/lib/wallet/events";
import { shortenWalletAddress } from "@/lib/cpu-access/format";
import { Check, Coins, ExternalLink, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The $CPU holder gate, as the browser sees it.
 *
 * Two rules shape this component:
 *
 * 1. It never decides access. The initial status is computed on the server and
 *    passed down; `Check Again` asks the server for a fresh read; and the only
 *    way "You're in." can appear is a `allowed: true` answer that came back from
 *    `/api/cpu/access`. Hiding the modal, editing local storage, or changing
 *    React state changes nothing, because every protected API repeats the same
 *    server-side decision for itself.
 * 2. It reads like a membership gate, not an error. No red alarm, no pressure,
 *    no countdown - just the requirement, the wallet, the numbers, and two ways
 *    forward.
 */

export type CpuGateView = {
  /** Signed-in wallet the server read. */
  walletAddress: string | null;
  /** Whole $CPU required, already grouped for display. */
  required: string | null;
  /** Exact configured minimum, for the deficit arithmetic in the UI. */
  minimumBalance: number;
  /** Display balance, truncated toward zero by the server. */
  balance: string | null;
  /** Exact displayed amount (never the raw bigint; that stays on the server). */
  deficit: string | null;
  symbol: string;
  /** `CPU_CHECK_FAILED` renders the "couldn't verify" variant. */
  reason: "INSUFFICIENT_CPU" | "CPU_CHECK_FAILED";
  message: string | null;
  buyUrl: string | null;
};

/** Fallback used only while a fresh check is in flight. */
export const cpuBuyUrlFallback = "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528";

/** Renders an already-formatted amount with the ticker, or a placeholder. */
export function formatGateAmount(value: string | null, symbol: string): string {
  return value ? `${value} $${symbol}` : `— $${symbol}`;
}

/** Whole-token value of a grouped display amount, for the "still needed" line. */
export function wholeTokensFrom(value: string | null): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/gu, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CpuAccessPanel({
  view,
  buying,
  checking,
  justPassed,
  signedOut = false,
  onCheckAgain,
  onBuy,
  onConnect,
  onDisconnect,
}: {
  view: CpuGateView;
  buying?: boolean;
  checking?: boolean;
  justPassed?: boolean;
  signedOut?: boolean;
  onCheckAgain?: () => void;
  onBuy?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}) {
  const symbol = view.symbol || "CPU";
  const buyHref = view.buyUrl || cpuBuyUrlFallback;
  const balance = wholeTokensFrom(view.balance);
  const deficit = signedOut
    ? null
    : (wholeTokensFrom(view.deficit) ?? (balance != null && view.minimumBalance > balance ? view.minimumBalance - balance : null));

  return (
    <div className="w-full rounded-2xl border border-violet-200/[0.12] bg-[var(--cabi-bg-deep)]/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,.55)] sm:rounded-2xl sm:p-7">
      <div className="flex items-center gap-3">
        <MiniCabi className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[var(--cabi-primary)]">Cabi Holder Access</p>
          <p className="mt-1 truncate text-sm text-[var(--cabi-text-secondary)]">
            {view.required ? `${view.required} $${symbol} required` : "Holder requirement"}
          </p>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-200/15 bg-violet-300/[0.07] text-[var(--cabi-primary)]">
          <Coins size={16} />
        </span>
      </div>

      <p className="mt-5 text-balance text-[15px] leading-6 text-[var(--cabi-text-secondary)] sm:text-base">
        {signedOut
          ? `Cabi is currently available to holders of at least ${view.required ? `${view.required} $${symbol}` : `the required $${symbol}`}. Connect your wallet to check.`
          : view.reason === "CPU_CHECK_FAILED"
            ? (view.message ?? "Cabi couldn't verify your $CPU balance right now.")
            : <>You&apos;re connected, but Cabi is currently available to holders of at least <span className="font-semibold text-white">{view.required ? `${view.required} $${symbol}` : `the required amount of $${symbol}`}</span>.</>}
      </p>

      <dl className="mt-5 space-y-2">
        <Row icon={<Wallet size={13} />} label="Your wallet" value={view.walletAddress ? shortenWalletAddress(view.walletAddress) : "Not connected"} mono={Boolean(view.walletAddress)} />
        {!signedOut && (
          <Row
            icon={<Coins size={13} />}
            label="Your balance"
            value={view.reason === "CPU_CHECK_FAILED" ? "Couldn't read" : formatGateAmount(view.balance, symbol)}
            emphasis
          />
        )}
        <Row icon={<ShieldCheck size={13} />} label="Required" value={view.required ? `${view.required} $${symbol}` : `— $${symbol}`} />
        {!signedOut && view.reason === "INSUFFICIENT_CPU" && (
          <Row icon={<Sparkles size={13} />} label="Still needed" value={deficit != null ? `${deficit.toLocaleString("en-US")} $${symbol}` : `— $${symbol}`} />
        )}
      </dl>

      <p className="mt-4 text-[12.5px] leading-5 text-[var(--cabi-text-muted)]">
        Grab ${symbol} on Clank.trade, then come back and check your balance again.
      </p>

      {justPassed && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-2.5 text-xs font-medium text-emerald-200">
          <Check size={14} /> You&apos;re in. Opening Cabi…
        </p>
      )}

      <div className="mt-5 grid gap-2">
        {signedOut && (
          <button
            type="button"
            onClick={onConnect}
            className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--cabi-primary)] to-[var(--cabi-primary-strong)] text-sm font-semibold text-[var(--cabi-on-primary)] shadow-[0_14px_40px_rgba(139,92,246,.22)] hover:brightness-105"
          >
            <Wallet size={16} /> Connect Wallet
          </button>
        )}
        {/* The buy destination is available in every state: it is the official
            $CPU page, and opening it grants nothing here. */}
        <a
          href={buyHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onBuy}
          className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--cabi-primary)] to-[var(--cabi-primary-strong)] text-sm font-semibold text-[var(--cabi-on-primary)] shadow-[0_14px_40px_rgba(139,92,246,.22)] hover:brightness-105"
        >
          {buying ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />} {signedOut ? `Buy $${symbol}` : `Open $${symbol} on Clank.trade`}
        </a>
        {!signedOut && (
          <>
            <button
              type="button"
              onClick={onCheckAgain}
              disabled={checking}
              className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--cabi-border)] bg-[var(--cabi-surface-2)] text-sm font-semibold text-white hover:bg-[var(--cabi-surface-3)] disabled:opacity-50"
            >
              {checking
                ? <><LoaderCircle size={16} className="animate-spin" /> Checking balance…</>
                : <><RefreshCw size={16} /> {view.reason === "CPU_CHECK_FAILED" ? "Try Again" : "Check Again"}</>}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="focus-ring flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-xs font-semibold text-[var(--cabi-text-muted)] hover:bg-[var(--cabi-surface-2)] hover:text-white"
            >
              <LogOut size={14} /> Disconnect Wallet
            </button>
          </>
        )}
      </div>

      <details className="mt-5 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3 py-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--cabi-text-secondary)]">How to get access</summary>
        <ol className="mt-3 space-y-1.5 pl-4 text-[12px] leading-5 text-[var(--cabi-text-muted)] [list-style:decimal]">
          <li>Open ${symbol} on Clank.trade.</li>
          <li>Connect your EVM wallet there.</li>
          <li>Buy enough ${symbol} to reach {view.required ? `${view.required} $${symbol}` : `the required amount`}.</li>
          <li>Return to Cabi.</li>
          <li>Press &ldquo;Check Again.&rdquo;</li>
        </ol>
      </details>

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-[var(--cabi-text-faint)]">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--cabi-primary)]" />
        Cabi reads your ${symbol} balance directly from the official contract on the server. Buying opens Clank.trade in a new tab and never sends a transaction from here.
      </p>
    </div>
  );
}

function Row({ icon, label, value, mono = false, emphasis = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; emphasis?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-1)] px-3.5 py-2.5">
      <dt className="flex items-center gap-2 text-[11px] uppercase tracking-[.13em] text-[var(--cabi-text-muted)]">{icon}{label}</dt>
      <dd className={`min-w-0 break-all text-right text-sm font-semibold ${emphasis ? "text-[var(--cabi-text-secondary)]" : "text-white"} ${mono ? "font-mono text-[13px]" : ""}`}>{value}</dd>
    </div>
  );
}

type AccessStatus = {
  allowed: boolean;
  reason: string;
  live: boolean;
  balance: string | null;
  deficit: string | null;
  required: string | null;
  symbol: string | null;
  message: string | null;
  buyUrl: string | null;
  walletAddress: string | null;
  gateEnabled?: boolean;
  minimumBalance?: number;
};

/**
 * Renders the holder gate for a signed-in wallet and owns the two recheck
 * triggers: the explicit "Check Again" button, and a wallet/account change.
 */
export function CpuHolderGate({ initial, fallbackBuyUrl }: { initial: CpuGateView; fallbackBuyUrl?: string | null }) {
  const wallet = useWallet();
  const router = useRouter();
  const [view, setView] = useState<CpuGateView>(initial);
  const [checking, setChecking] = useState(false);
  const [buying, setBuying] = useState(false);
  const [justPassed, setJustPassed] = useState(false);
  const [error, setError] = useState<string>();
  const announcedRef = useRef(false);
  const symbol = view.symbol || "CPU";

  const apply = useCallback((status: AccessStatus) => {
    if (status.allowed) {
      setJustPassed(true);
      setError(undefined);
      announceCpuHolderStatusChanged();
      // The unlock itself comes from the server: refreshing re-renders the page
      // boundary, which re-resolves access with the same rules. The short pause
      // is only so the confirmation is readable before the app replaces it.
      window.setTimeout(() => router.refresh(), 900);
      return true;
    }
    setView((current) => ({
      ...current,
      reason: status.reason === "CPU_CHECK_FAILED" ? "CPU_CHECK_FAILED" : "INSUFFICIENT_CPU",
      walletAddress: status.walletAddress ?? wallet.address ?? current.walletAddress,
      balance: status.balance,
      deficit: status.deficit,
      required: status.required ?? current.required,
      symbol: status.symbol ?? current.symbol,
      message: status.message,
      buyUrl: status.buyUrl ?? fallbackBuyUrl ?? current.buyUrl,
    }));
    announceCpuHolderStatusChanged();
    return false;
  }, [fallbackBuyUrl, router, wallet.address]);

  const check = useCallback(async () => {
    setChecking(true);
    setError(undefined);
    try {
      const response = await fetch("/api/cpu/access", { cache: "no-store" });
      if (!response.ok) throw new Error();
      apply(await response.json() as AccessStatus);
    } catch {
      setError("Cabi couldn't verify your $CPU balance right now.");
      setView((current) => ({ ...current, reason: "CPU_CHECK_FAILED", message: "Cabi couldn't verify your $CPU balance right now." }));
    } finally {
      setChecking(false);
    }
  }, [apply]);

  // A stale refusal has to be able to unblock itself. `Check Again` is the
  // explicit path; this listener covers a refusal by a protected API, which the
  // browser reports as an event so no request handler has to know about the UI.
  useEffect(() => {
    const onBlocked = () => { void check(); };
    window.addEventListener(cpuGateBlockedEvent, onBlocked);
    return () => window.removeEventListener(cpuGateBlockedEvent, onBlocked);
  }, [check]);

  // Switching accounts in the wallet extension invalidates the session, so the
  // page is re-resolved on the server rather than left showing the previous
  // wallet's numbers. Reloading is not a bypass: the same server rules run again.
  const { authenticatedAt } = wallet;
  const seenAuthenticationRef = useRef(authenticatedAt);
  useEffect(() => {
    if (seenAuthenticationRef.current === authenticatedAt) return;
    seenAuthenticationRef.current = authenticatedAt;
    router.refresh();
  }, [authenticatedAt, router]);

  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    void fetch("/api/cpu/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "cpu_gate_viewed" }) }).catch(() => undefined);
  }, []);

  const openBuyLink = useCallback(() => {
    setBuying(true);
    window.setTimeout(() => setBuying(false), 1200);
    void fetch("/api/cpu/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "cpu_buy_link_opened" }) }).catch(() => undefined);
  }, []);

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-transparent px-4 py-10">
      <div className="pointer-events-none absolute left-1/2 top-1/4 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/[0.13] blur-[90px]" />
      <div className="relative w-full max-w-[440px]">
        <CpuAccessPanel
          view={{ ...view, symbol }}
          checking={checking}
          buying={buying}
          justPassed={justPassed}
          onCheckAgain={() => void check()}
          onBuy={openBuyLink}
          onDisconnect={() => void wallet.disconnect()}
        />
        {error && <p role="alert" className="mt-3 text-center text-xs text-rose-200">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The signed-out (or not-yet-verified) side of the gate.
 *
 * Signing in is what starts the real check for this wallet. The decision itself
 * is never taken here: when a wallet session appears, the page is re-resolved so
 * the server can answer, and only a server answer of `allowed` opens the app.
 * That keeps a targeted reload from being a bypass - reloading produces the same
 * server decision.
 */
export function CpuSignedOutGate({
  required,
  minimumBalance,
  buyUrl,
  initial,
}: {
  required: string | null;
  minimumBalance: number;
  buyUrl?: string | null;
  /** Server-built initial view, so the first paint needs no client fetch. */
  initial?: { view: CpuGateView; overlay?: boolean };
}) {
  const wallet = useWallet();
  const router = useRouter();
  const requiredText = required ?? minimumBalance.toLocaleString("en-US");
  const [buying, setBuying] = useState(false);
  const checkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!wallet.sessionLoaded || !wallet.authenticated || !wallet.address) return;
    if (checkedRef.current === wallet.address) return;
    checkedRef.current = wallet.address;
    let cancelled = false;
    // The gate is what the server rendered, so a wallet session appearing here
    // means eligibility was never evaluated for it. Ask the server; if it says
    // yes, reloading renders the application instead of this panel.
    void (async () => {
      try {
        const response = await fetch("/api/cpu/access", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const status = await response.json() as { allowed?: boolean };
        if (status.allowed) {
          // The server already recorded the pass on the request above. Nothing in
          // the browser may raise its own credit - reloading simply lets the
          // server render the application it just authorized.
          window.location.reload();
        }
      } catch {
        // A failed check leaves the gate standing, which is the safe answer.
      }
    })();
    return () => { cancelled = true; };
  }, [wallet.address, wallet.authenticated, wallet.sessionLoaded]);

  useEffect(() => {
    const onAuthenticated = (event: Event) => {
      const detail = (event as CustomEvent<{ authenticated?: boolean }>).detail;
      if (detail?.authenticated) router.refresh();
    };
    window.addEventListener(walletAuthenticatedEvent, onAuthenticated);
    return () => window.removeEventListener(walletAuthenticatedEvent, onAuthenticated);
  }, [router]);

  const view: CpuGateView = initial?.view ?? {
    walletAddress: wallet.address,
    required: requiredText,
    minimumBalance,
    balance: null,
    deficit: null,
    symbol: "CPU",
    reason: "INSUFFICIENT_CPU",
    message: null,
    buyUrl: buyUrl ?? cpuBuyUrlFallback,
  };

  const openBuy = () => {
    setBuying(true);
    window.setTimeout(() => setBuying(false), 1200);
    void fetch("/api/cpu/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "cpu_buy_link_opened" }) }).catch(() => undefined);
  };

  return (
    <div className={`relative flex w-full items-center justify-center overflow-x-hidden px-4 ${initial?.overlay ? "absolute inset-0 z-[60] bg-[var(--cabi-bg)]/92 backdrop-blur-md" : "min-h-[100dvh] py-10"}`}>
      <div className="pointer-events-none absolute left-1/2 top-1/4 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/[0.12] blur-[90px]" />
      <div className="relative w-full max-w-[440px]">
        <CpuAccessPanel
          view={view}
          signedOut={!view.walletAddress}
          buying={buying}
          onConnect={wallet.openConnect}
          onBuy={openBuy}
        />
      </div>
    </div>
  );
}
