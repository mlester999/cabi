import "server-only";

import { env } from "@/lib/config/env";
import { getServiceClient } from "@/lib/db/supabase";
import { normalizeWalletAddress } from "@/lib/wallet/address";

export type OwnerWallet = {
  id: string | null;
  walletAddress: string;
  label: string;
  enabled: boolean;
  source: "database" | "environment";
  createdAt: string | null;
  lastUsedAt: string | null;
};

function addressKey(value: unknown): string {
  return normalizeWalletAddress(value).uniqueKey;
}

function bootstrapAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const value of (env("ADMIN_PREVIEW_WALLETS") ?? "").split(",")) {
    try { addresses.add(addressKey(value)); } catch { /* Ignore malformed bootstrap entries. */ }
  }
  return addresses;
}

/** A database row, including a disabled one, always overrides environment bootstrap. */
export async function isAuthorizedOwnerWallet(value: unknown): Promise<boolean> {
  let key: string;
  try { key = addressKey(value); } catch { return false; }
  const db = getServiceClient();
  if (!db) return false;
  const { data, error } = await db.from("admin_wallets").select("enabled").eq("wallet_address", key).maybeSingle();
  if (error) return false;
  if (data) return data.enabled === true;
  return bootstrapAddresses().has(key);
}

export async function listOwnerWallets(): Promise<OwnerWallet[]> {
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { data, error } = await db.from("admin_wallets")
    .select("id,wallet_address,label,enabled,created_at,last_used_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error("OWNER_WALLETS_UNAVAILABLE");
  const records = new Map<string, OwnerWallet>();
  for (const row of data ?? []) {
    const key = addressKey(row.wallet_address);
    records.set(key, {
      id: row.id,
      walletAddress: normalizeWalletAddress(key).address,
      label: row.label,
      enabled: row.enabled,
      source: "database",
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    });
  }
  for (const key of bootstrapAddresses()) {
    if (records.has(key)) continue;
    records.set(key, {
      id: null,
      walletAddress: normalizeWalletAddress(key).address,
      label: "Environment bootstrap",
      enabled: true,
      source: "environment",
      createdAt: null,
      lastUsedAt: null,
    });
  }
  return [...records.values()];
}

export async function saveOwnerWallet(value: unknown, label: string): Promise<OwnerWallet[]> {
  const key = addressKey(value);
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { error } = await db.from("admin_wallets")
    .upsert({ wallet_address: key, label: label.trim(), enabled: true }, { onConflict: "wallet_address" });
  if (error) throw new Error("OWNER_WALLET_SAVE_FAILED");
  return listOwnerWallets();
}

/** Keep a disabled row so an environment bootstrap value cannot restore access. */
export async function disableOwnerWallet(value: unknown): Promise<OwnerWallet[]> {
  const key = addressKey(value);
  const db = getServiceClient();
  if (!db) throw new Error("DATABASE_NOT_CONFIGURED");
  const { data: existing, error: readError } = await db.from("admin_wallets")
    .select("label").eq("wallet_address", key).maybeSingle();
  if (readError) throw new Error("OWNER_WALLET_SAVE_FAILED");
  const { error } = await db.from("admin_wallets")
    .upsert({ wallet_address: key, label: existing?.label ?? "", enabled: false }, { onConflict: "wallet_address" });
  if (error) throw new Error("OWNER_WALLET_SAVE_FAILED");
  return listOwnerWallets();
}

export async function markOwnerWalletUsed(value: unknown): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  try {
    await db.from("admin_wallets").update({ last_used_at: new Date().toISOString() })
      .eq("wallet_address", addressKey(value)).eq("enabled", true);
  } catch { /* Login succeeds even if this optional timestamp cannot be saved. */ }
}
