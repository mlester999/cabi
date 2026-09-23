/**
 * Small in-process TTL cache.
 *
 * Used for read-only public chain data (native balance, token metadata). It is
 * deliberately:
 *
 * - short-lived, so a balance is never meaningfully stale;
 * - in-process only, so nothing transaction-sensitive is written to shared
 *   storage;
 * - never used for anything a user must see fresh after acting.
 */
type Entry<T> = { value: T; expiresAt: number };

export function createTtlCache<T>(ttlMs: number, maxEntries = 500) {
  const store = new Map<string, Entry<T>>();

  return {
    get(key: string): { value: T; age: number } | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return { value: entry.value, age: Date.now() - (entry.expiresAt - ttlMs) };
    },
    set(key: string, value: T) {
      if (store.size >= maxEntries) {
        // Cheap eviction: drop the oldest inserted key.
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key: string) { store.delete(key); },
    /** Removes every entry whose key satisfies the predicate. */
    deleteWhere(predicate: (key: string) => boolean) {
      for (const key of [...store.keys()]) if (predicate(key)) store.delete(key);
    },
    clear() { store.clear(); },
    size() { return store.size; },
  };
}

/** Milliseconds a wallet snapshot stays cacheable. Short on purpose. */
export const walletSnapshotTtlMs = 20_000;

/** Token metadata changes very rarely, so it can live longer than a balance. */
export const tokenMetadataTtlMs = 5 * 60_000;