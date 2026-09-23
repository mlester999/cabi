/** Pure policy boundary shared by tests and the chat route. */
export function shouldPersistChat(walletAccountId: string | null | undefined, requestedPersistence: boolean | undefined) {
  return Boolean(walletAccountId && requestedPersistence !== false);
}

export function shouldImportGuestChat(decision: "save" | "temporary") {
  return decision === "save";
}
