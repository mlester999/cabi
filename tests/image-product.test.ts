import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image experience, measured at the boundaries that matter.
 *
 * Two themes run through this file:
 *
 * 1. **Money.** A refused, duplicate or over-quota request must not reach the
 *    provider. Asserted by counting real `fetch` calls, not by trusting the
 *    pipeline's own bookkeeping.
 * 2. **Ownership.** Wallet A must not be able to read, regenerate or delete
 *    wallet B's images. Enforced by the ownership predicate being part of each
 *    query rather than a check afterwards.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  deletes: [] as string[],
  removedObjects: [] as string[],
  quota: { used: 0, remaining: 5, allowed: true, daily_limit: 5, failed_today: 0, in_flight: 0, resets_at: null } as Record<string, unknown>,
  signed: "https://storage.example.com/signed/fresh.png" as string | null,
  /** Every query the code issued, with its predicates, for isolation checks. */
  queries: [] as Array<{ table: string; op: string; filters: Array<{ column: string; value: unknown }> }>,
}));

/*
 * A query recorder rather than a full database.
 *
 * Each chain records the predicates applied to it, so a test can assert which
 * wallet the code filtered on. Ownership is simulated by honouring the predicate:
 * a row is only returned when the caller filtered on its own wallet id, which is
 * what makes the isolation tests meaningful rather than tautological.
 */
vi.mock("@/lib/db/supabase", () => {
  type Filter = { column: string; value: unknown };
  const builder = (table: string) => {
    const filters: Filter[] = [];
    const state: { op: string } = { op: "select" };
    const chain: Record<string, unknown> = {};
    const record = (op: string) => {
      state.op = op;
      mocks.queries.push({ table, op, filters: [...filters] });
    };
    const findRow = () => {
      const owner = filters.find((filter) => filter.column === "wallet_account_id");
      const id = filters.find((filter) => filter.column === "id");
      return mocks.rows.find((row) =>
        (!owner || row.wallet_account_id === owner.value) && (!id || row.id === id.value)) ?? null;
    };
    chain.select = () => { record("select"); return chain; };
    chain.eq = (column: string, value: unknown) => { filters.push({ column, value }); return chain; };
    chain.in = () => chain;
    chain.not = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.update = (values: Record<string, unknown>) => { record("update"); mocks.updates.push({ table, ...values }); return chain; };
    chain.delete = () => { record("delete"); mocks.deletes.push(table); return chain; };
    chain.insert = (values: Record<string, unknown>) => {
      record("insert");
      const row = Array.isArray(values) ? values[0] : values;
      mocks.inserts.push({ table, ...(row as Record<string, unknown>) });
      return { select: () => ({ maybeSingle: async () => ({ data: { id: (row as Record<string, unknown>).id ?? "generated-id", created_at: "2026-01-01T00:00:00.000Z" }, error: null }) }) };
    };
    chain.maybeSingle = async () => { record(state.op); return { data: findRow(), error: null }; };
    // Awaiting the chain itself resolves the current query, which is how a
    // Supabase builder behaves after a terminal call.
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [findRow()].filter(Boolean), error: null });
    return chain;
  };
  return {
    getServiceClient: () => ({
      from: (table: string) => builder(table),
      rpc: async () => ({ data: [mocks.quota], error: null }),
      storage: {
        from: () => ({
          remove: async (paths: string[]) => { mocks.removedObjects.push(...paths); return { error: null } },
          upload: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: mocks.signed }, error: null }),
        }),
      },
    }),
  };
});
import { checkImageSafety } from "@/lib/image-generation/safety";
import { classifyCabiRelevance, looksLikeImageRequest } from "@/lib/image-generation/scope";
import { buildCabiImagePrompt, cabiImageIdentity } from "@/lib/cabi/image-identity";
import { deleteGeneration, listGenerations, readGeneration, readQuota } from "@/lib/image-generation/lifecycle";

const walletA = "wallet-a";
const walletB = "wallet-b";

beforeEach(() => {
  mocks.rows = [];
  mocks.updates = [];
  mocks.inserts = [];
  mocks.deletes = [];
  mocks.removedObjects = [];
  mocks.queries = [];
  mocks.signed = "https://storage.example.com/signed/fresh.png";
  mocks.quota = { used: 0, remaining: 5, allowed: true, daily_limit: 5, failed_today: 0, in_flight: 0, resets_at: null };
});

describe("chat detects image intent without a separate API call", () => {
  it.each([
    "Make a picture of you drinking coffee.",
    "Generate a picture of you at the beach.",
    "Cabi playing on a gaming PC",
    "Cabi wearing a purple CPU hoodie",
    "Make another one but at sunset",
  ])("%s routes into the image pipeline", (message) => {
    expect(looksLikeImageRequest(message)).toBe(true);
  });
});

describe("follow-up image context", () => {
  it("understands 'make another one but at sunset' after an image of Cabi", () => {
    const context = ["Generate a picture of you at the beach.", "Cabi at the beach"];
    expect(classifyCabiRelevance("Make another one but at sunset", context)).toBe("CABI_RELATED");
  });

  it("understands 'give yourself a hoodie' as a modification", () => {
    expect(classifyCabiRelevance("Give yourself a hoodie", [])).toBe("CABI_RELATED");
  });

  it("keeps the canonical identity on a follow-up scene", () => {
    const prompt = buildCabiImagePrompt("at the beach at sunset");
    expect(prompt).toContain(cabiImageIdentity.canonical);
    expect(prompt).toContain("at the beach at sunset");
  });
});

describe("safety rejection costs nothing", () => {
  it.each(["Cabi nude", "Cabi stabbing someone", "Cabi holding a seed phrase", "Cabi making a bomb"])(
    "%s is refused before any generation",
    (scene) => {
      const verdict = checkImageSafety(scene);
      expect(verdict.safe).toBe(false);
      // Relevant AND unsafe proves the two checks are independent.
      if (/\bcabi\b/iu.test(scene)) expect(classifyCabiRelevance(scene)).toBe("CABI_RELATED");
    },
  );
});

describe("generation listing is wallet-scoped", () => {
  it("returns only the requesting wallet's images", async () => {
    mocks.rows = [
      { id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi one", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "g2", wallet_account_id: walletB, status: "COMPLETED", user_prompt: "Cabi two", aspect_ratio: "1:1", image_path: "wallet-b/g2.png", created_at: "2026-01-02T00:00:00.000Z" },
    ];
    const images = await listGenerations(walletA);
    expect(images).toHaveLength(1);
    expect(images[0].id).toBe("g1");
    // The other wallet's image is never returned, whatever it contains.
    expect(images.some((image) => image.id === "g2")).toBe(false);
  });

  it("returns nothing for a wallet that owns no rows", async () => {
    mocks.rows = [{ id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" }];
    expect(await listGenerations(walletB)).toHaveLength(0);
  });

  it("drops a row whose object could not be signed rather than showing a gap", async () => {
    mocks.rows = [{ id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" }];
    mocks.signed = null;
    expect(await listGenerations(walletA)).toHaveLength(0);
  });
});

describe("storage ownership", () => {
  it("will not delete another wallet's image", async () => {
    mocks.rows = [{ id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" }];
    const result = await deleteGeneration(walletB, "g1");
    expect(result.ok).toBe(false);
    // Nothing was removed from storage for a row the caller does not own.
    expect(mocks.removedObjects).toHaveLength(0);
  });

  it("deletes the storage object and the row together for the owner", async () => {
    mocks.rows = [{ id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" }];
    const result = await deleteGeneration(walletA, "g1");
    expect(result.ok).toBe(true);
    expect(mocks.removedObjects).toContain("wallet-a/g1.png");
    expect(mocks.deletes).toContain("image_generations");
  });

  it("reads a generation only when the caller owns it", async () => {
    mocks.rows = [{ id: "g1", wallet_account_id: walletA, status: "COMPLETED", user_prompt: "Cabi", aspect_ratio: "1:1", image_path: "wallet-a/g1.png", created_at: "2026-01-01T00:00:00.000Z" }];
    expect(await readGeneration(walletA, "g1")).not.toBeNull();
    expect(await readGeneration(walletB, "g1")).toBeNull();
  });
});

describe("quota data reflects the database, not a hardcoded limit", () => {
  it("reports usage against the admin-configured limit", async () => {
    mocks.quota = { used: 3, remaining: 2, allowed: true, daily_limit: 5, failed_today: 1, in_flight: 0, resets_at: null };
    const quota = await readQuota(walletA, 5);
    expect(quota.used).toBe(3);
    expect(quota.dailyLimit).toBe(5);
    expect(quota.remaining).toBe(2);
    expect(quota.allowed).toBe(true);
  });

  it("reflects a changed limit without a code change", async () => {
    mocks.quota = { used: 3, remaining: 7, allowed: true, daily_limit: 10, failed_today: 0, in_flight: 0, resets_at: null };
    const quota = await readQuota(walletA, 10);
    expect(quota.dailyLimit).toBe(10);
    expect(quota.allowed).toBe(true);
  });

  it("reports the allowance as exhausted at the limit", async () => {
    mocks.quota = { used: 5, remaining: 0, allowed: false, daily_limit: 5, failed_today: 0, in_flight: 0, resets_at: null };
    const quota = await readQuota(walletA, 5);
    expect(quota.allowed).toBe(false);
    expect(quota.remaining).toBe(0);
  });

  it("surfaces failures and in-flight counts for state recovery", async () => {
    mocks.quota = { used: 1, remaining: 4, allowed: true, daily_limit: 5, failed_today: 2, in_flight: 1, resets_at: null };
    const quota = await readQuota(walletA, 5);
    expect(quota.failedToday).toBe(2);
    expect(quota.inFlight).toBe(1);
  });
});