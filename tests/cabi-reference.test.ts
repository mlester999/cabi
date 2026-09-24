import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The official Cabi reference.
 *
 * The properties that matter: the bundled asset is the priority-2 default, an
 * active admin upload overrides it, replacing never destroys the previous version,
 * and an invalid image is rejected on its bytes rather than on a declared type.
 *
 * The database is stubbed at the `getServiceClient` boundary, and the stub is
 * re-read on every call, so activating a version inside a test is visible to the
 * module exactly as a real write would be.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  stored: new Map<string, Uint8Array>(),
  inserted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

function activeRow() {
  return mocks.rows.find((row) => row.active === true) ?? null;
}

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table !== "cabi_references") {
        const inert: Record<string, unknown> = {};
        inert.select = () => inert;
        inert.eq = () => inert;
        inert.maybeSingle = async () => ({ data: null, error: null });
        return inert;
      }
      const query: Record<string, unknown> = {};
      let filterActive = false;
      let orderedDescending = false;
      query.select = () => query;
      query.order = (_column: string, options?: { ascending?: boolean }) => {
        orderedDescending = options?.ascending === false;
        return query;
      };
      query.limit = () => query;
      // `listCabiReferences` awaits the builder directly, so the stub has to be
      // thenable and return the sorted rows.
      query.then = (resolve: (result: unknown) => unknown) => {
        const rows = [...mocks.rows].sort((a, b) => orderedDescending
          ? Number(b.version) - Number(a.version)
          : Number(a.version) - Number(b.version));
        return resolve({ data: rows, error: null });
      };
      query.eq = (column: string, value: unknown) => {
        if (column === "active" && value === true) filterActive = true;
        return query;
      };
      query.maybeSingle = async () => {
        if (filterActive) return { data: activeRow(), error: null };
        return { data: mocks.rows[0] ?? null, error: null };
      };
      query.insert = (value: Record<string, unknown>) => {
        mocks.inserted.push(value);
        const row = { ...value, id: `row-${mocks.rows.length + 1}` };
        mocks.rows.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
      };
      query.update = (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        // Mirrors PostgREST: the update is applied by the filters that follow it,
        // and the affected row is only returned when `.select()` was requested.
        let selected = false;
        let updatedRow: Record<string, unknown> | null = null;
        const applyTo = (rows: Array<Record<string, unknown>>) => {
          for (const row of rows) Object.assign(row, value);
          if (rows.length > 0) updatedRow = rows[0];
        };
        const chain: Record<string, unknown> = {};
        chain.select = () => {
          selected = true;
          return chain;
        };
        chain.eq = (column: string, expected: unknown) => {
          if (column === "active" && expected === true) {
            applyTo(mocks.rows.filter((row) => row.active === true));
          } else if (column === "id") {
            applyTo(mocks.rows.filter((row) => row.id === expected));
          } else {
            applyTo(mocks.rows);
          }
          return chain;
        };
        chain.maybeSingle = async () => ({ data: selected ? updatedRow : null, error: null });
        chain.then = (resolve: (result: unknown) => unknown) => {
          // An unfiltered builder still applies and resolves.
          if (!selected && mocks.updates.length > 0) applyTo(mocks.rows.filter((row) => row.active === true));
          return resolve({ error: null });
        };
        return chain;
      };
      return query;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          const bytes = mocks.stored.get(path);
          if (!bytes) return { data: null, error: { message: "not found" } };
          return {
            data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
            error: null,
          };
        },
        upload: async (path: string, bytes: Uint8Array) => {
          mocks.stored.set(path, bytes);
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.example/signed/${path}` }, error: null }),
      }),
    },
  }),
}));

import { cabiFallbackReferenceAsset, cabiReferencePathFor, validateCabiReferenceBytes } from "@/lib/cabi/reference/types";
import { readImageDimensions } from "@/lib/cabi/reference/storage.server";
import { activateCabiReference, listCabiReferences, saveCabiReference } from "@/lib/cabi/reference/store.server";
import { resolveCabiReference } from "@/lib/cabi/reference/resolve.server";

/** A valid PNG: real magic bytes plus real dimensions in the header. */
function pngBytes(width = 500, height = 500, filler = 256) {
  const bytes = new Uint8Array(24 + filler);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegBytes() {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function webpBytes() {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.stored.clear();
  mocks.inserted.length = 0;
  mocks.updates.length = 0;
});

describe("reference bytes validation", () => {
  it("accepts PNG, JPEG, and WebP by magic bytes", () => {
    expect(validateCabiReferenceBytes(pngBytes())).toMatchObject({ ok: true, mimeType: "image/png", extension: "png" });
    expect(validateCabiReferenceBytes(jpegBytes())).toMatchObject({ ok: true, mimeType: "image/jpeg" });
    expect(validateCabiReferenceBytes(webpBytes())).toMatchObject({ ok: true, mimeType: "image/webp" });
  });

  it("rejects anything that is not a real image", () => {
    // SVG is text, and a browser treats it as active content on a storage origin.
    expect(validateCabiReferenceBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).ok).toBe(false);
    expect(validateCabiReferenceBytes(new TextEncoder().encode("<!doctype html><html><body>hi</body></html>")).ok).toBe(false);
    expect(validateCabiReferenceBytes(new Uint8Array(0)).ok).toBe(false);
    expect(validateCabiReferenceBytes(new Uint8Array(4)).ok).toBe(false);
  });

  it("rejects an image above the size limit", () => {
    const result = validateCabiReferenceBytes(pngBytes(500, 500, 9 * 1024 * 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("too large");
  });

  it("maps a mime type to the canonical object slot", () => {
    expect(cabiReferencePathFor("image/png")).toBe("official/cabi-reference.png");
    expect(cabiReferencePathFor("image/jpeg")).toBe("official/cabi-reference.jpg");
    expect(cabiReferencePathFor("image/webp")).toBe("official/cabi-reference.webp");
  });
});

describe("image dimension reading", () => {
  it("reads PNG dimensions from the header", () => {
    expect(readImageDimensions(pngBytes(1024, 768), "image/png")).toEqual({ width: 1024, height: 768 });
  });

  it("reads JPEG dimensions from the frame header", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
    bytes[4] = 0x00; bytes[5] = 0x11;
    bytes[6] = 0x08;
    bytes[7] = 0x02; bytes[8] = 0x00;
    bytes[9] = 0x03; bytes[10] = 0x00;
    expect(readImageDimensions(bytes, "image/jpeg")).toEqual({ width: 768, height: 512 });
  });

  it("returns null rather than guessing for unparseable data", () => {
    expect(readImageDimensions(new Uint8Array(8), "image/png")).toBeNull();
    expect(readImageDimensions(new Uint8Array(8), "image/jpeg")).toBeNull();
    expect(readImageDimensions(new Uint8Array(8), "image/gif")).toBeNull();
  });
});

describe("reference resolution priority", () => {
  it("uses the bundled asset when no admin reference is active", async () => {
    const resolved = await resolveCabiReference();
    if (!("source" in resolved)) throw new Error("expected a resolved reference");
    expect(resolved.source).toBe("BUNDLED");
    expect(resolved.version).toBe(0);
    expect(resolved.path).toBe(cabiFallbackReferenceAsset);
    expect(resolved.bytes).toBeNull();
    // Nothing to condition on, so a capable model is driven by the bible instead.
    expect(resolved.conditionable).toBe(false);
  });

  it("prefers an active admin upload over the bundled asset", async () => {
    mocks.rows.push({
      id: "ref-3",
      storage_path: "official/cabi-reference.png",
      version: 3,
      active: true,
      uploaded_at: "2026-09-24T00:00:00.000Z",
      uploaded_by: "owner@cabi.test",
      width: 1024,
      height: 1024,
      mime_type: "image/png",
      hash: "abc",
    });
    mocks.stored.set("official/cabi-reference.png", pngBytes(1024, 1024));
    const resolved = await resolveCabiReference();
    if (!("source" in resolved)) throw new Error("expected a resolved reference");
    expect(resolved.source).toBe("ADMIN_UPLOAD");
    expect(resolved.version).toBe(3);
    expect(resolved.bytes).toBeInstanceOf(Uint8Array);
    expect(resolved.signedUrl).toContain("official/cabi-reference.png");
    expect(resolved.conditionable).toBe(true);
  });

  it("falls back to the bundled asset when the stored object is unreadable", async () => {
    mocks.rows.push({
      id: "ref-4",
      storage_path: "official/cabi-reference.png",
      version: 4,
      active: true,
      uploaded_at: "2026-09-24T00:00:00.000Z",
      uploaded_by: "owner@cabi.test",
      width: null,
      height: null,
      mime_type: "image/png",
      hash: "abc",
    });
    const resolved = await resolveCabiReference();
    if (!("source" in resolved)) throw new Error("expected a resolved reference");
    // A storage hiccup must not stop Cabi being drawn, and the fallback is the
    // same character rather than a different one.
    expect(resolved.source).toBe("BUNDLED");
    expect(resolved.path).toBe(cabiFallbackReferenceAsset);
  });
});

describe("reference versioning", () => {
  it("stores a new version and makes it the only active one", async () => {
    const first = await saveCabiReference({ bytes: pngBytes(512, 512), uploadedBy: "owner@cabi.test" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reference.version).toBe(1);
    expect(first.reference.active).toBe(true);
    expect(first.reference.width).toBe(512);
    expect(first.reference.height).toBe(512);
    expect(first.reference.mimeType).toBe("image/png");

    const second = await saveCabiReference({ bytes: pngBytes(768, 768), uploadedBy: "owner@cabi.test" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reference.version).toBe(2);
    // The version it replaced is reported back, so the audit entry can name it.
    expect(second.previous?.version).toBe(1);

    // Exactly one active row, which the partial unique index also enforces.
    expect(mocks.rows.filter((row) => row.active === true)).toHaveLength(1);
    expect(mocks.rows.find((row) => row.active === true)?.version).toBe(2);
  });

  it("archives the previous version instead of destroying it", async () => {
    await saveCabiReference({ bytes: pngBytes(512, 512), uploadedBy: "owner@cabi.test" });
    await saveCabiReference({ bytes: pngBytes(640, 640), uploadedBy: "owner@cabi.test" });
    // The pre-replacement bytes are copied to an immutable versioned path.
    expect(mocks.stored.has("official/versions/cabi-reference-v1.png")).toBe(true);
  });

  it("refuses an invalid image and changes nothing", async () => {
    const result = await saveCabiReference({ bytes: new TextEncoder().encode("not an image at all"), uploadedBy: "owner@cabi.test" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_IMAGE");
    expect(mocks.rows).toHaveLength(0);
  });

  it("restores a previous version and keeps exactly one active", async () => {
    const first = await saveCabiReference({ bytes: pngBytes(512, 512), uploadedBy: "owner@cabi.test" });
    if (!first.ok) return;
    await saveCabiReference({ bytes: pngBytes(640, 640), uploadedBy: "owner@cabi.test" });

    const restored = await activateCabiReference(String(first.reference.id));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(mocks.rows.filter((row) => row.active === true)).toHaveLength(1);
    expect(mocks.rows.find((row) => row.active === true)?.version).toBe(1);
  });

  it("refuses to restore a version whose image is gone", async () => {
    const first = await saveCabiReference({ bytes: pngBytes(512, 512), uploadedBy: "owner@cabi.test" });
    if (!first.ok) return;
    mocks.stored.delete(String(first.reference.storagePath));
    const restored = await activateCabiReference(String(first.reference.id));
    expect(restored.ok).toBe(false);
  });

  it("lists history newest first with a single active entry", async () => {
    await saveCabiReference({ bytes: pngBytes(512, 512), uploadedBy: "owner@cabi.test" });
    await saveCabiReference({ bytes: pngBytes(640, 640), uploadedBy: "owner@cabi.test" });
    const history = await listCabiReferences();
    expect(history.map((row) => row.version)).toEqual([2, 1]);
    expect(history.filter((row) => row.active)).toHaveLength(1);
  });
});
