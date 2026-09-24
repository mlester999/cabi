export type OwnerPreviewToken = {
  sessionId: string;
  walletAddressKey: string;
  expiresAt: number;
};

export function validateOwnerPreviewToken(value: unknown, now = Date.now()): OwnerPreviewToken | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const token = value as Record<string, unknown>;
  if (token.scope !== "wallet_preview") return null;
  if (typeof token.sessionId !== "string" || !/^[0-9a-f-]{36}$/iu.test(token.sessionId)) return null;
  if (typeof token.walletAddressKey !== "string" || !/^0x[0-9a-f]{40}$/u.test(token.walletAddressKey)) return null;
  if (typeof token.expiresAt !== "number" || !Number.isFinite(token.expiresAt) || token.expiresAt <= now) return null;
  return { sessionId: token.sessionId, walletAddressKey: token.walletAddressKey, expiresAt: token.expiresAt };
}
