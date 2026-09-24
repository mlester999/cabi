import { getAddress, isAddress } from "viem";

/**
 * Canonical configuration for the Cabi holder access gate.
 *
 * Every value the gate authorizes against resolves through this one file. The
 * contract address is deliberately NOT scattered across components: the browser
 * may display it, but only this module decides which ERC-20 the server reads,
 * and a request can never supply its own contract, chain, or RPC.
 *
 * Verified facts for the official $CPU token (read from the contract itself and
 * cross-checked against the published Robinhood Chain registry):
 *
 *   chain id      4663  (Robinhood Chain, mainnet)
 *   contract      0x1a421a5065316d9b4062939e9959ddece6630528
 *   name          Cat Partner Unit
 *   symbol        CPU
 *   decimals      18  -  never assumed, always read from `decimals()`
 *   coin page     https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528
 */

/** The official $CPU ERC-20 contract used by the access gate. */
export const CPU_ACCESS_TOKEN_ADDRESS = "0x1a421a5065316d9b4062939e9959ddece6630528" as const;

/** The official $CPU coin page. Also the only destination the Buy button opens. */
export const CPU_ACCESS_BUY_URL = `https://clank.trade/coin/${CPU_ACCESS_TOKEN_ADDRESS}` as const;

/** Host the Buy button is allowed to open. Nothing else may be substituted. */
export const cpuAccessBuyHosts: readonly string[] = ["clank.trade", "www.clank.trade"] as const;

/** Verified chain details for the $CPU access gate. */
export const cpuAccessChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
} as const;

/**
 * Default minimum holding for the gate, in whole $CPU.
 *
 * Centralized on purpose: raising or lowering access is a one-line change here,
 * or a server-side admin setting, and never a number typed into a component.
 */
export const CPU_MIN_ACCESS_BALANCE = 1_000_000;

/** Upper bound accepted for an owner-edited minimum. Guards against absurd input. */
export const CPU_MAX_ACCESS_BALANCE = 1_000_000_000_000;

/** Default of the server-side feature flag `cpu_holder_gate_enabled`. */
export const cpuHolderGateEnabledByDefault = true;

/** Approved admin/owner wallets skip the holding requirement by default. */
export const cpuGateAdminBypassByDefault = true;

function environmentAddress(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  if (!raw || !isAddress(raw, { strict: false })) return fallback;
  return getAddress(raw.toLowerCase());
}

function environmentChainId(): number {
  const raw = process.env.CPU_ACCESS_CHAIN_ID?.trim();
  if (!raw) return cpuAccessChain.id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : cpuAccessChain.id;
}

function environmentRpcUrl(): string {
  const raw = process.env.CPU_ACCESS_RPC_URL?.trim();
  if (!raw) return cpuAccessChain.rpcUrl;
  try {
    const url = new URL(raw);
    // HTTPS only, and never a URL carrying credentials.
    if (url.protocol !== "https:" || url.username || url.password) return cpuAccessChain.rpcUrl;
    return raw;
  } catch {
    return cpuAccessChain.rpcUrl;
  }
}

/**
 * The contract the gate authorizes against, resolved once from the official
 * value. An environment override is accepted only when it parses as an EVM
 * address; anything else falls back to the official contract instead of
 * disabling the gate.
 */
export const CPU_ACCESS_CONTRACT: string = environmentAddress("CPU_ACCESS_TOKEN_ADDRESS", CPU_ACCESS_TOKEN_ADDRESS);

/** Chain id and RPC the gate reads from. Never taken from a request. */
export const CPU_ACCESS_CHAIN_ID: number = environmentChainId();
export const CPU_ACCESS_RPC_URL: string = environmentRpcUrl();

/** The official buy destination, or `null` when the configured one is not trusted. */
export function cpuBuyUrlFor(candidate?: string | null): string | null {
  const value = (candidate ?? CPU_ACCESS_BUY_URL).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!cpuAccessBuyHosts.includes(url.hostname.toLowerCase())) return null;
    if (url.pathname.replace(/\/+$/u, "").toLowerCase() !== `/coin/${CPU_ACCESS_CONTRACT}`.toLowerCase()) return null;
    return `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}
