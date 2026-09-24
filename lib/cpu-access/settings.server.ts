import "server-only";

import { getAddress, isAddress } from "viem";

import {
  CPU_ACCESS_BUY_URL,
  CPU_ACCESS_CHAIN_ID,
  CPU_ACCESS_CONTRACT,
  CPU_ACCESS_RPC_URL,
  CPU_MAX_ACCESS_BALANCE,
  CPU_MIN_ACCESS_BALANCE,
  cpuBuyUrlFor,
  cpuGateAdminBypassByDefault,
  cpuHolderGateEnabledByDefault,
} from "@/lib/cpu-access/config";
import { env, envBoolean } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { createTtlCache } from "@/lib/wallet-data/cache";

/**
 * Server-side $CPU holder gate settings.
 *
 * These values are authorization inputs, so they live on the server and are read
 * through `readCpuAccessGateSettings()`. Nothing here is ever taken from a
 * request body, a query parameter, React state, or local storage - the admin
 * console writes them with the service role and every protected decision
 * re-reads them.
 *
 * The resolved `contract` always equals the official $CPU contract. An owner can
 * switch the gate off and change the minimum, but cannot point access at some
 * other token.
 */

export type CpuAccessGateSettings = {
  /** `cpu_holder_gate_enabled` - the gate's server-side feature flag. */
  enabled: boolean;
  /** Whole $CPU tokens required for normal wallets. */
  minimumBalance: number;
  /** The one contract the gate will ever read. */
  contract: string;
  chainId: number;
  rpcUrl: string;
  /** Whether approved owner/admin wallets skip the holding requirement. */
  allowAdminBypass: boolean;
  /** Exact official Clank.trade coin page used by the Buy button. */
  buyUrl: string;
};

/**
 * Where each effective value came from, so `/admin/cpu` can be honest about
 * whether the gate is running on built-in defaults or a saved setting.
 */
export type CpuAccessGateSource = {
  enabled: "default" | "environment" | "database";
  minimumBalance: "default" | "database";
  allowAdminBypass: "default" | "environment" | "database";
  contract: "official" | "environment";
};

/** `app_settings` key holding the owner's `cpu_access_gate` row. Also the flag name. */
export const cpuAccessGateSettingKey = "cpu_access_gate";
export const cpuHolderGateFlagKey = "cpu_holder_gate_enabled";

/** A saved admin change becomes visible within this window. */
export const cpuAccessGateSettingsTtlMs = 15_000;

const settingsCache = createTtlCache<CpuAccessGateSettings>(cpuAccessGateSettingsTtlMs, 8);

function officialContract(): string {
  return isAddress(CPU_ACCESS_CONTRACT, { strict: false })
    ? getAddress(CPU_ACCESS_CONTRACT.toLowerCase())
    : CPU_ACCESS_CONTRACT;
}

/** Rejects out-of-range minimums instead of clamping them to something usable. */
export function boundedMinimumBalance(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.trunc(parsed);
  if (whole < 1) return null;
  if (whole > CPU_MAX_ACCESS_BALANCE) return null;
  return whole;
}

function officialDefaults(): CpuAccessGateSettings {
  return {
    enabled: cpuHolderGateEnabledByDefault,
    minimumBalance: CPU_MIN_ACCESS_BALANCE,
    contract: officialContract(),
    chainId: CPU_ACCESS_CHAIN_ID,
    rpcUrl: CPU_ACCESS_RPC_URL,
    allowAdminBypass: cpuGateAdminBypassByDefault,
    buyUrl: cpuBuyUrlFor(CPU_ACCESS_BUY_URL) ?? CPU_ACCESS_BUY_URL,
  };
}

/** Deployment-level overrides, applied on top of the built-in official defaults. */
function withEnvironment(base: CpuAccessGateSettings): { settings: CpuAccessGateSettings; source: CpuAccessGateSource } {
  const source: CpuAccessGateSource = {
    enabled: "default",
    minimumBalance: "default",
    allowAdminBypass: "default",
    contract: CPU_ACCESS_CONTRACT === base.contract ? "official" : "environment",
  };
  const settings = { ...base };

  if (env("CPU_HOLDER_GATE_ENABLED") != null) {
    settings.enabled = envBoolean("CPU_HOLDER_GATE_ENABLED", settings.enabled);
    source.enabled = "environment";
  }
  if (env("CPU_GATE_ALLOW_ADMIN_BYPASS") != null) {
    settings.allowAdminBypass = envBoolean("CPU_GATE_ALLOW_ADMIN_BYPASS", settings.allowAdminBypass);
    source.allowAdminBypass = "environment";
  }
  return { settings, source };
}

/**
 * Applies a stored `app_settings.cpu_access_gate` row on top of the defaults.
 *
 * Unknown keys are dropped. The contract, chain, and buy URL are accepted only
 * when they equal the official values, so a hand-edited row can never redirect
 * the gate at another token, another chain, or another host.
 */
export function parseCpuAccessGateSettings(value: unknown, base: CpuAccessGateSettings = officialDefaults()): CpuAccessGateSettings {
  const record = (value ?? {}) as Record<string, unknown>;
  const settings = { ...base };

  if (typeof record.enabled === "boolean") settings.enabled = record.enabled;
  if (typeof record.allowAdminBypass === "boolean") settings.allowAdminBypass = record.allowAdminBypass;

  const minimum = boundedMinimumBalance(record.minimumBalance);
  if (minimum !== null) settings.minimumBalance = minimum;

  const storedContract = typeof record.contract === "string" && isAddress(record.contract, { strict: false })
    ? getAddress(record.contract.toLowerCase())
    : null;
  if (storedContract && storedContract === settings.contract) settings.contract = storedContract;

  const storedChainId = typeof record.chainId === "number" ? Math.trunc(record.chainId) : Number.NaN;
  if (Number.isSafeInteger(storedChainId) && storedChainId === settings.chainId) settings.chainId = storedChainId;

  return settings;
}

export async function readCpuAccessGateSettings(
  options: { fresh?: boolean } = {},
): Promise<{ settings: CpuAccessGateSettings; source: CpuAccessGateSource }> {
  const base = officialDefaults();
  const { settings: environmentSettings, source } = withEnvironment(base);

  if (!options.fresh) {
    const hit = settingsCache.get("gate");
    if (hit) return { settings: hit.value, source };
  }

  let settings = environmentSettings;
  const db = getServiceClient();
  if (db) {
    try {
      const { data, error } = await db
        .from("app_settings")
        .select("value_json")
        .eq("key", cpuAccessGateSettingKey)
        .maybeSingle();
      // A database outage resolves to the safe defaults rather than to "gate
      // off": an unreadable row must never unlock the application.
      if (!error && data) {
        const record = (data.value_json ?? {}) as Record<string, unknown>;
        settings = parseCpuAccessGateSettings(record, environmentSettings);
        if (typeof record.enabled === "boolean") source.enabled = "database";
        if (boundedMinimumBalance(record.minimumBalance) !== null) source.minimumBalance = "database";
        if (typeof record.allowAdminBypass === "boolean") source.allowAdminBypass = "database";
      }
    } catch {
      settings = environmentSettings;
    }
  }

  settingsCache.set("gate", settings);
  return { settings, source };
}

/** Persists an owner change. Callers audit the result themselves. */
export async function writeCpuAccessGateSettings(
  patch: { enabled?: boolean; minimumBalance?: number; allowAdminBypass?: boolean },
  actor: string,
): Promise<CpuAccessGateSettings> {
  const current = await readCpuAccessGateSettings({ fresh: true });
  const next: CpuAccessGateSettings = { ...current.settings };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.allowAdminBypass === "boolean") next.allowAdminBypass = patch.allowAdminBypass;
  if (patch.minimumBalance !== undefined) {
    const minimum = boundedMinimumBalance(patch.minimumBalance);
    if (minimum === null) throw new Error("INVALID_MINIMUM_BALANCE");
    next.minimumBalance = minimum;
  }

  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { error } = await db.from("app_settings").upsert(
    {
      key: cpuAccessGateSettingKey,
      value_json: {
        enabled: next.enabled,
        minimumBalance: next.minimumBalance,
        allowAdminBypass: next.allowAdminBypass,
        contract: next.contract,
        chainId: next.chainId,
        buyUrl: next.buyUrl,
        updatedBy: actor,
        updatedAt: new Date().toISOString(),
      },
      updated_by: actor,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error("SAVE_FAILED");
  settingsCache.set("gate", next);
  return next;
}

export function invalidateCpuAccessGateSettingsCache() {
  settingsCache.clear();
}
