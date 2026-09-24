"use client";

import { cpuHolderStatusChangedEvent } from "@/lib/cpu-access/events";
import { useEffect, useRef, useState } from "react";

/**
 * Long-session eligibility monitor.
 *
 * An open Cabi session must not outlive the holdings that earned it. This runs
 * only while the application is actually rendered, and it never decides
 * anything: it asks the server (which re-reads the balance) whether access still
 * holds, and if it does not, reloads the page so the server-rendered holder gate
 * replaces the application.
 *
 * Cadence is deliberately unhurried - a time-based poll plus a check when the
 * tab regains focus - so a normal session costs one small request every minute
 * and the RPC is never touched on render.
 */
export const cpuStatusPollMs = 60_000;
export const cpuStatusFocusMinIntervalMs = 10_000;

export function CpuAccessStatusMonitor({ intervalMs = cpuStatusPollMs }: { intervalMs?: number }) {
  const [paused, setPaused] = useState(false);
  const lastCheckRef = useRef(0);
  const reloadingRef = useRef(false);

  useEffect(() => {
    const onChanged = () => setPaused(true);
    window.addEventListener(cpuHolderStatusChangedEvent, onChanged);
    return () => window.removeEventListener(cpuHolderStatusChangedEvent, onChanged);
  }, []);

  useEffect(() => {
    if (paused || reloadingRef.current) return;
    let cancelled = false;

    const check = async () => {
      lastCheckRef.current = Date.now();
      try {
        const response = await fetch("/api/cpu/access", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const status = await response.json() as { allowed?: boolean; reason?: string };
        if (cancelled || status.allowed !== false) return;
        // Only a live holder-gate refusal reloads the page. A prelaunch or
        // unauthenticated answer is handled by whatever rendered this page.
        if (status.reason !== "INSUFFICIENT_CPU" && status.reason !== "CPU_CHECK_FAILED") return;
        reloadingRef.current = true;
        window.location.reload();
      } catch {
        // A transient failure must never lock anyone out on its own.
      }
    };

    const timer = window.setInterval(() => void check(), intervalMs);
    const onFocus = () => {
      if (reloadingRef.current) return;
      if (Date.now() - lastCheckRef.current < cpuStatusFocusMinIntervalMs) return;
      void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [intervalMs, paused]);

  return null;
}
