import type { TradingProvider } from "@/lib/trading/provider";
import {
  normalizeTradeAddress,
  parseClankTradeUrl,
  type ResolvedToken,
  type TradeQuote,
  type TransactionRequest,
} from "@/lib/trading/types";

/**
 * Clank.trade adapter.
 *
 * IMPORTANT: this is a **link** provider on purpose.
 *
 * The available integration path was checked before writing this. No official,
 * documented Clank.trade SDK, public trade API, router address, or ABI is
 * referenced anywhere in this project, and nothing verifiable is published that
 * this codebase can rely on. Guessing an endpoint, or copying calldata from a web
 * page, would put user funds behind an unverified transaction. So this adapter:
 *
 * - resolves a token to an exact, verified coin page;
 * - prepares an external link the user opens in a new tab;
 * - reports `supportsDirectTransactions: false`, which the UI states plainly;
 * - returns `null` from `getQuote` / `prepareBuy` / `prepareSell`.
 *
 * When an official interface exists, implement those three methods. The only
 * place a `TransactionRequest` may be constructed is `buildTransactionRequest`,
 * so the intent layer, the trade states, the confirmation requirement, and the
 * wallet safety rules all stay exactly as they are.
 */

export type ClankTradeAdapterOptions = {
  /** Verified coin URL per contract address, from owner configuration. */
  verifiedTokenUrls?: Record<string, string>;
  /** The owner-configured $CPU coin page. */
  configuredCpu?: { address: string; url: string; symbol?: string; name?: string } | null;
};

function key(address: string) {
  return address.toLowerCase();
}

export function createClankTradeProvider(options: ClankTradeAdapterOptions = {}): TradingProvider {
  const verifiedTokenUrls = new Map<string, string>();
  for (const [address, url] of Object.entries(options.verifiedTokenUrls ?? {})) {
    const safe = parseClankTradeUrl(url);
    if (!safe) continue;
    try { verifiedTokenUrls.set(key(normalizeTradeAddress(address)), safe); } catch { /* ignore malformed configured address */ }
  }

  const cpuAddress = (() => {
    if (!options.configuredCpu?.address) return null;
    try { return key(normalizeTradeAddress(options.configuredCpu.address)); } catch { return null; }
  })();
  const cpuUrl = options.configuredCpu?.url ? parseClankTradeUrl(options.configuredCpu.url) : null;

  const tokenPageUrl = (token: Pick<ResolvedToken, "address" | "verifiedUrl">): string | null => {
    if (cpuAddress && cpuUrl && key(token.address) === cpuAddress) return cpuUrl;
    const configured = verifiedTokenUrls.get(key(token.address));
    if (configured) return configured;
    if (token.verifiedUrl) return parseClankTradeUrl(token.verifiedUrl);
    return null;
  };

  return {
    id: "CLANK_TRADE",
    label: "Clank.trade",
    supportsDirectTransactions: false,

    /**
     * Resolves a token from an explicit contract address or from the configured
     * $CPU coin.
     *
     * A bare ticker is *never* treated as unique. With no verifiable registry
     * configured, an unknown ticker resolves to nothing and the UI asks the user
     * for the exact contract address or Clank.trade page instead of guessing.
     */
    async resolveToken(input) {
      const candidates: ResolvedToken[] = [];
      const push = (candidate: Omit<ResolvedToken, "verified">) => {
        if (candidates.some((existing) => key(existing.address) === key(candidate.address))) return;
        const url = tokenPageUrl(candidate);
        candidates.push({ ...candidate, verifiedUrl: url ?? undefined, verified: Boolean(url) });
      };

      if (input.address) {
        let normalized: string;
        try { normalized = normalizeTradeAddress(input.address); } catch { return []; }
        const isCpu = Boolean(cpuAddress && cpuAddress === key(normalized));
        push({
          address: normalized,
          symbol: isCpu ? (options.configuredCpu?.symbol ?? "CPU") : (input.symbol ?? "").replace(/^\$/u, "").toUpperCase(),
          name: isCpu ? (options.configuredCpu?.name ?? "Cat Partner Unit") : (input.symbol ?? "Unverified token"),
          chainId: input.chainId ?? 0,
          origin: isCpu ? "CONFIGURED" : "USER_PROVIDED",
        });
        return candidates;
      }

      const symbol = (input.symbol ?? "").replace(/^\$/u, "").trim().toUpperCase();
      if (!symbol) return [];
      if (cpuAddress && options.configuredCpu?.address) {
        const cpuSymbol = (options.configuredCpu.symbol ?? "CPU").toUpperCase();
        if (symbol === cpuSymbol) {
          push({
            address: normalizeTradeAddress(options.configuredCpu.address),
            symbol: cpuSymbol,
            name: options.configuredCpu.name ?? "Cat Partner Unit",
            chainId: input.chainId ?? 0,
            origin: "CONFIGURED",
          });
        }
      }
      // Every other ticker stays unresolved on purpose: symbols are not unique.
      return candidates;
    },

    async getQuote(): Promise<TradeQuote | null> { return null; },
    async prepareBuy(): Promise<TransactionRequest | null> { return null; },
    async prepareSell(): Promise<TransactionRequest | null> { return null; },

    tokenPageUrl,
  };
}

/** The provider the application uses until a documented interface exists. */
export const clankTradeProvider = createClankTradeProvider();