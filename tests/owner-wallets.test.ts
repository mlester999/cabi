import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  bootstrap: "" as string,
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceClient: mocks.database }));
vi.mock("@/lib/config/env", () => ({ env: (name: string) => name === "ADMIN_PREVIEW_WALLETS" ? mocks.bootstrap : undefined }));

import { disableOwnerWallet, isAuthorizedOwnerWallet, listOwnerWallets, saveOwnerWallet } from "@/lib/site/owner-wallets";

const address = "0x00000000000000000000000000000000000000a1";

function database() {
  type Row = { id: string; wallet_address: string; label: string; enabled: boolean; created_at: string; last_used_at: null };
  const rows = new Map<string, Row>();
  let readError = false;
  const db = {
    from: vi.fn((table: string) => {
      expect(table).toBe("admin_wallets");
      return {
        select: () => ({
          eq: (_field: string, key: string) => ({
            maybeSingle: async () => ({ data: rows.get(key) ?? null, error: readError ? { message: "unavailable" } : null }),
          }),
          order: async () => ({ data: [...rows.values()], error: readError ? { message: "unavailable" } : null }),
        }),
        upsert: async (record: { wallet_address: string; label: string; enabled: boolean }) => {
          const existing = rows.get(record.wallet_address);
          rows.set(record.wallet_address, {
            id: existing?.id ?? crypto.randomUUID(),
            wallet_address: record.wallet_address,
            label: record.label,
            enabled: record.enabled,
            created_at: existing?.created_at ?? "2026-09-24T00:00:00.000Z",
            last_used_at: null,
          });
          return { error: null };
        },
      };
    }),
  };
  mocks.database.mockReturnValue(db);
  return { rows, setReadError(value: boolean) { readError = value; } };
}

describe("owner-wallet allowlist", () => {
  beforeEach(() => {
    mocks.bootstrap = "";
    mocks.database.mockReset();
  });

  it("never authorizes an arbitrary wallet, including with no database", async () => {
    mocks.database.mockReturnValue(null);
    expect(await isAuthorizedOwnerWallet(address)).toBe(false);
    expect(await isAuthorizedOwnerWallet("not-an-address")).toBe(false);
  });

  it("accepts a valid explicit environment bootstrap only when the database has no row", async () => {
    const state = database();
    mocks.bootstrap = `invalid, ${address.toUpperCase().replace("0X", "0x")}`;
    expect(await isAuthorizedOwnerWallet(address)).toBe(true);
    expect((await listOwnerWallets())[0]).toMatchObject({ enabled: true, source: "environment" });

    await disableOwnerWallet(address);
    expect(state.rows.get(address)?.enabled).toBe(false);
    expect(await isAuthorizedOwnerWallet(address)).toBe(false);
    expect((await listOwnerWallets())[0]).toMatchObject({ enabled: false, source: "database" });

    await saveOwnerWallet(address, "Mark Owner Wallet");
    expect(await isAuthorizedOwnerWallet(address)).toBe(true);
    expect((await listOwnerWallets())[0]).toMatchObject({ label: "Mark Owner Wallet", enabled: true, source: "database" });
  });

  it("fails closed on a database read error even when the address is in bootstrap", async () => {
    const state = database();
    mocks.bootstrap = address;
    state.setReadError(true);
    expect(await isAuthorizedOwnerWallet(address)).toBe(false);
    await expect(listOwnerWallets()).rejects.toThrow("OWNER_WALLETS_UNAVAILABLE");
  });
});
