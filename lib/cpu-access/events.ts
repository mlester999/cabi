/**
 * A browser event, not an authority.
 *
 * When a protected API refuses a request because the wallet does not (or no
 * longer) meet the $CPU requirement, the client announces it on this event so
 * the gate can ask the server for a fresh decision. Anything can dispatch it;
 * nothing is granted by doing so.
 */
export const cpuGateBlockedEvent = "cabi:cpu-gate-blocked";

/**
 * Fired whenever the app learns that holder eligibility changed in either
 * direction. The status monitor uses it to stop polling once the gate is
 * showing, and the gate uses it to pick up a fresh decision.
 */
export const cpuHolderStatusChangedEvent = "cabi:cpu-holder-status-changed";

export type CpuGateBlockedDetail = {
  code?: string;
  message?: string;
};

/** Safe to call from anywhere in the browser: it carries no authority. */
export function announceCpuGateBlocked(detail: CpuGateBlockedDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CpuGateBlockedDetail>(cpuGateBlockedEvent, { detail }));
}

export function announceCpuHolderStatusChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(cpuHolderStatusChangedEvent));
}
