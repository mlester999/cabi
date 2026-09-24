/**
 * Wallet lifecycle events.
 *
 * These only *announce* what already happened on the server. A wallet session is
 * created by a verified signature at `/api/wallet/verify`, so an event listener
 * cannot authenticate anyone - it can only decide to re-read the authoritative
 * state (a server re-render or a fresh status request).
 */
export const walletAuthenticatedEvent = "cabi:wallet-authenticated";
export const walletDisconnectedEvent = "cabi:wallet-disconnected";

export type WalletAuthenticatedDetail = {
  address: string | null;
  /** True only when a real wallet session exists (never for guests). */
  authenticated: boolean;
};

function emit(name: string, detail: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Called by the wallet provider once the server confirmed the signature. */
export function announceWalletAuthenticated(detail: WalletAuthenticatedDetail) {
  emit(walletAuthenticatedEvent, detail);
}

export function announceWalletDisconnected(detail: WalletAuthenticatedDetail = { address: null, authenticated: false }) {
  emit(walletDisconnectedEvent, detail);
}
