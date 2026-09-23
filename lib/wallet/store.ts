import "server-only";

import type { Address } from "viem";

import { requireServiceClient } from "@/lib/db/supabase";

export type WalletNonceRecord = {
  id: string;
  walletAddress: Address;
  walletAddressUniqueKey: string;
  nonceHash: string;
  expiresAt: string;
  usedAt: string | null;
};

export type WalletAccountRecord = {
  id: string;
  walletAddress: Address;
  walletAddressUniqueKey: string;
};

export type WalletSessionRecord = {
  id: string;
  walletAccountId: string;
  profileId: string;
  walletAddress: Address;
  walletAddressUniqueKey: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type WalletAuthStore = {
  createNonce(input: {
    walletAddress: Address;
    walletAddressUniqueKey: string;
    nonceHash: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void>;
  findNonce(nonceHash: string): Promise<WalletNonceRecord | null>;
  consumeNonce(input: {
    id: string;
    walletAddressUniqueKey: string;
    consumedAt: string;
  }): Promise<boolean>;
  upsertWalletAccount(input: {
    walletAddress: Address;
    walletAddressUniqueKey: string;
    lastLoginAt: string;
  }): Promise<WalletAccountRecord>;
  ensureProfile(walletAccountId: string): Promise<string>;
  createSession(input: {
    id: string;
    walletAccountId: string;
    sessionTokenHash: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void>;
  findSession(sessionTokenHash: string): Promise<WalletSessionRecord | null>;
  revokeSession(input: { sessionTokenHash: string; revokedAt: string }): Promise<boolean>;
};

type Row = Record<string, unknown>;

function databaseError(action: string, error: { code?: string; message?: string } | null) {
  return new Error(`WALLET_AUTH_DATABASE_ERROR:${action}:${error?.code ?? "unknown"}`);
}

function asString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw databaseError(`invalid_${key}`, null);
  return value;
}

/** Server-only persistence adapter. Raw nonces and raw session tokens never reach Postgres. */
export function createSupabaseWalletAuthStore(): WalletAuthStore {
  const client = requireServiceClient();

  return {
    async createNonce(input) {
      const { error } = await client.from("wallet_nonces").insert({
        wallet_address: input.walletAddress,
        wallet_address_unique_key: input.walletAddressUniqueKey,
        nonce_hash: input.nonceHash,
        expires_at: input.expiresAt,
        created_at: input.createdAt,
      });
      if (error) throw databaseError("create_nonce", error);
    },

    async findNonce(nonceHash) {
      const { data, error } = await client
        .from("wallet_nonces")
        .select("id,wallet_address,wallet_address_unique_key,nonce_hash,expires_at,used_at")
        .eq("nonce_hash", nonceHash)
        .maybeSingle();
      if (error) throw databaseError("find_nonce", error);
      if (!data) return null;
      const row = data as Row;
      return {
        id: asString(row, "id"),
        walletAddress: asString(row, "wallet_address") as Address,
        walletAddressUniqueKey: asString(row, "wallet_address_unique_key"),
        nonceHash: asString(row, "nonce_hash"),
        expiresAt: asString(row, "expires_at"),
        usedAt: typeof row.used_at === "string" ? row.used_at : null,
      };
    },

    async consumeNonce(input) {
      const { data, error } = await client
        .from("wallet_nonces")
        .update({ used_at: input.consumedAt })
        .eq("id", input.id)
        .eq("wallet_address_unique_key", input.walletAddressUniqueKey)
        .is("used_at", null)
        .gt("expires_at", input.consumedAt)
        .select("id")
        .maybeSingle();
      if (error) throw databaseError("consume_nonce", error);
      return Boolean(data);
    },

    async upsertWalletAccount(input) {
      const { data, error } = await client
        .from("wallet_accounts")
        .upsert({
          wallet_address: input.walletAddress,
          wallet_address_unique_key: input.walletAddressUniqueKey,
          last_login_at: input.lastLoginAt,
        }, { onConflict: "wallet_address_unique_key" })
        .select("id,wallet_address,wallet_address_unique_key")
        .single();
      if (error || !data) throw databaseError("upsert_wallet_account", error);
      const row = data as Row;
      return {
        id: asString(row, "id"),
        walletAddress: asString(row, "wallet_address") as Address,
        walletAddressUniqueKey: asString(row, "wallet_address_unique_key"),
      };
    },

    async ensureProfile(walletAccountId) {
      const { data, error } = await client
        .from("profiles")
        .upsert({ wallet_account_id: walletAccountId }, { onConflict: "wallet_account_id" })
        .select("id")
        .single();
      if (error || !data) throw databaseError("ensure_profile", error);
      return asString(data as Row, "id");
    },

    async createSession(input) {
      const { error } = await client.from("auth_sessions").insert({
        id: input.id,
        wallet_account_id: input.walletAccountId,
        session_token_hash: input.sessionTokenHash,
        expires_at: input.expiresAt,
        created_at: input.createdAt,
      });
      if (error) throw databaseError("create_session", error);
    },

    async findSession(sessionTokenHash) {
      const { data: session, error: sessionError } = await client
        .from("auth_sessions")
        .select("id,wallet_account_id,expires_at,revoked_at")
        .eq("session_token_hash", sessionTokenHash)
        .maybeSingle();
      if (sessionError) throw databaseError("find_session", sessionError);
      if (!session) return null;
      const sessionRow = session as Row;
      const walletAccountId = asString(sessionRow, "wallet_account_id");

      const [{ data: account, error: accountError }, { data: profile, error: profileError }] = await Promise.all([
        client.from("wallet_accounts").select("id,wallet_address,wallet_address_unique_key").eq("id", walletAccountId).maybeSingle(),
        client.from("profiles").select("id").eq("wallet_account_id", walletAccountId).maybeSingle(),
      ]);
      if (accountError) throw databaseError("find_session_account", accountError);
      if (profileError) throw databaseError("find_session_profile", profileError);
      if (!account || !profile) return null;
      const accountRow = account as Row;
      return {
        id: asString(sessionRow, "id"),
        walletAccountId,
        profileId: asString(profile as Row, "id"),
        walletAddress: asString(accountRow, "wallet_address") as Address,
        walletAddressUniqueKey: asString(accountRow, "wallet_address_unique_key"),
        expiresAt: asString(sessionRow, "expires_at"),
        revokedAt: typeof sessionRow.revoked_at === "string" ? sessionRow.revoked_at : null,
      };
    },

    async revokeSession(input) {
      const { data, error } = await client
        .from("auth_sessions")
        .update({ revoked_at: input.revokedAt })
        .eq("session_token_hash", input.sessionTokenHash)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw databaseError("revoke_session", error);
      return Boolean(data);
    },
  };
}
