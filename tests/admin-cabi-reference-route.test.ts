import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin reference API.
 *
 * Two properties matter most: a non-admin can do nothing here, and an
 * unauthenticated caller is refused before a single byte of the body is read.
 */

const mocks = vi.hoisted(() => ({
  // Annotated: individual tests resolve this to a refusal, and an inferred
  // `{ session: { email: string }; response: null }` would reject that.
  admin: vi.fn(async (): Promise<{ session: { email: string } | null; response: Response | null }> => ({ session: { email: "owner@cabi.test" }, response: null })),
  audit: vi.fn(async () => undefined),
  save: vi.fn(),
  activate: vi.fn(),
  list: vi.fn(async () => [] as unknown[]),
  resolve: vi.fn(),
  previewUrl: vi.fn(async () => "https://storage.example/signed/reference.png"),
  settings: vi.fn(async () => ({ provider: "together", model: "Qwen/Qwen-Image-2.0", hasApiKey: true, enabled: true })),
  bible: vi.fn(async () => ({ artDirection: "", negative: "", customized: false })),
  writeBible: vi.fn(),
  resetBible: vi.fn(async () => ({ artDirection: "", negative: "", customized: false })),
}));

vi.mock("@/lib/admin/auth", () => ({ adminOrResponse: mocks.admin }));
vi.mock("@/lib/admin/audit", () => ({ auditAdmin: mocks.audit }));
// The route is deliberately not site-mode gated: the admin session is the
// authorization, so the owner can manage Cabi's identity asset during PRELAUNCH.
vi.mock("@/lib/image-generation/settings", () => ({ readImageSettings: mocks.settings }));
vi.mock("@/lib/cabi/character-bible.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cabi/character-bible.server")>();
  return {
    ...actual,
    readCabiCharacterBible: mocks.bible,
    writeCabiCharacterBible: mocks.writeBible,
    resetCabiCharacterBible: mocks.resetBible,
  };
});
vi.mock("@/lib/cabi/reference/store.server", () => ({
  saveCabiReference: mocks.save,
  activateCabiReference: mocks.activate,
  listCabiReferences: mocks.list,
  cabiReferencePreviewUrl: mocks.previewUrl,
}));
vi.mock("@/lib/cabi/reference/resolve.server", () => ({ resolveCabiReference: mocks.resolve }));

import { GET, PATCH, POST } from "@/app/api/admin/cabi-reference/route";

/** A real PNG header, so the server-side magic-byte check is what accepts it. */
function pngBytes() {
  const bytes = new Uint8Array(320);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function uploadRequest(body: Uint8Array, contentType = "image/png") {
  return new Request("http://localhost:5173/api/admin/cabi-reference", {
    method: "POST",
    headers: { "content-type": contentType },
    // A Blob is a BodyInit; a raw Uint8Array is not in the DOM type surface.
    body: new Blob([body as unknown as BlobPart], { type: contentType }),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost:5173/api/admin/cabi-reference", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.admin.mockReset();
  mocks.admin.mockResolvedValue({ session: { email: "owner@cabi.test" }, response: null });
  mocks.audit.mockReset();
  mocks.audit.mockResolvedValue(undefined);
  mocks.save.mockReset();
  mocks.save.mockResolvedValue({ ok: true, reference: { id: "ref-1", version: 1, mimeType: "image/png", width: 500, height: 500, hash: "h" }, previous: null });
  mocks.activate.mockReset();
  mocks.activate.mockResolvedValue({ ok: true, reference: { id: "ref-1", version: 1 } });
  mocks.list.mockReset();
  mocks.list.mockResolvedValue([]);
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue({ source: "BUNDLED", version: 0, path: "/assets/cabi-cpu-model.png", mimeType: "image/png", width: 500, height: 500, bytes: null, signedUrl: null, conditionable: false });
  mocks.bible.mockReset();
  mocks.bible.mockResolvedValue({ artDirection: "", negative: "", customized: false });
  mocks.writeBible.mockReset();
  mocks.writeBible.mockResolvedValue({ artDirection: "notes", negative: "", customized: true });
  mocks.resetBible.mockReset();
  mocks.resetBible.mockResolvedValue({ artDirection: "", negative: "", customized: false });
});

describe("a non-admin cannot touch the reference", () => {
  it("refuses a GET with 401", async () => {
    mocks.admin.mockResolvedValue({ session: null, response: Response.json({ error: "Admin sign-in required.", code: "ADMIN_UNAUTHORIZED" }, { status: 401 }) });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("refuses an upload with 401 and never stores anything", async () => {
    mocks.admin.mockResolvedValue({ session: null, response: Response.json({ error: "Admin sign-in required.", code: "ADMIN_UNAUTHORIZED" }, { status: 401 }) });
    const response = await POST(uploadRequest(pngBytes()));
    expect(response.status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses a restore with 401", async () => {
    mocks.admin.mockResolvedValue({ session: null, response: Response.json({ error: "Admin sign-in required.", code: "ADMIN_UNAUTHORIZED" }, { status: 401 }) });
    const response = await PATCH(patchRequest({ activateId: "ref-1" }));
    expect(response.status).toBe(401);
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});

describe("uploading a reference", () => {
  it("stores a valid PNG and audits the change with the previous version", async () => {
    mocks.save.mockResolvedValue({
      ok: true,
      reference: { id: "ref-2", version: 2, mimeType: "image/png", width: 1024, height: 1024, hash: "abc" },
      previous: { version: 1 },
    });
    const response = await POST(uploadRequest(pngBytes()));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok?: boolean; previousVersion?: number };
    expect(body.ok).toBe(true);
    expect(body.previousVersion).toBe(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [auditCall] = mocks.audit.mock.calls;
    expect((auditCall as unknown[])[2]).toBe("cabi.reference_upload");
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("rejects an empty upload", async () => {
    const response = await POST(uploadRequest(new Uint8Array(0)));
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects a non-image and records the failure", async () => {
    mocks.save.mockResolvedValue({ ok: false, code: "INVALID_IMAGE", message: "Use a PNG, JPEG, or WebP image. PNG is recommended." });
    const response = await POST(uploadRequest(new TextEncoder().encode("<svg></svg>"), "image/png"));
    expect(response.status).toBe(400);
    const payload = await response.json() as { code?: string };
    expect(payload.code).toBe("INVALID_IMAGE");
    expect(mocks.audit).toHaveBeenCalled();
    const outcomes = mocks.audit.mock.calls.map((call) => (call as unknown[])[5]);
    expect(outcomes).toContain("failure");
  });

  it("refuses an oversized body without reading it", async () => {
    const request = new Request("http://localhost:5173/api/admin/cabi-reference", {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": String(12 * 1024 * 1024) },
      body: new Blob([new Uint8Array(16) as unknown as BlobPart], { type: "image/png" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("restoring a version", () => {
  it("restores a previous version and audits it", async () => {
    const response = await PATCH(patchRequest({ activateId: "ref-1" }));
    expect(response.status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith("ref-1");
    expect(mocks.audit).toHaveBeenCalled();
    const [first] = mocks.audit.mock.calls;
    expect((first as unknown[])[2]).toBe("cabi.reference_restore");
  });

  it("refuses a restore with no id", async () => {
    const response = await PATCH(patchRequest({}));
    expect(response.status).toBe(400);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("reports a restore failure rather than pretending it worked", async () => {
    mocks.activate.mockResolvedValue({ ok: false, message: "That version's image is no longer in storage." });
    const response = await PATCH(patchRequest({ activateId: "ref-9" }));
    expect(response.status).toBe(400);
    const payload = await response.json() as { code?: string };
    expect(payload.code).toBe("RESTORE_FAILED");
  });
});

describe("character bible editing", () => {
  it("saves non-critical notes and audits them", async () => {
    const response = await PATCH(patchRequest({ section: "bible", bible: { artDirection: "soft watercolour", negative: "blurry" } }));
    expect(response.status).toBe(200);
    expect(mocks.writeBible).toHaveBeenCalledTimes(1);
    const [first] = mocks.audit.mock.calls;
    expect((first as unknown[])[2]).toBe("cabi.character_bible_update");
  });

  it("rejects notes beyond the length cap", async () => {
    const response = await PATCH(patchRequest({ section: "bible", bible: { artDirection: "x".repeat(700), negative: "" } }));
    expect(response.status).toBe(400);
    expect(mocks.writeBible).not.toHaveBeenCalled();
  });

  it("resets to the shipped defaults", async () => {
    const response = await PATCH(patchRequest({ section: "bible-reset" }));
    expect(response.status).toBe(200);
    expect(mocks.resetBible).toHaveBeenCalledTimes(1);
    const [first] = mocks.audit.mock.calls;
    expect((first as unknown[])[2]).toBe("cabi.character_bible_reset");
  });
});

describe("capability reporting", () => {
  it("says SUPPORTED for the recommended reference-capable model", async () => {
    const payload = await (await GET()).json() as { provider: { capabilities: { supportsReferenceImages: boolean }; message: string } };
    expect(payload.provider.capabilities.supportsReferenceImages).toBe(true);
    expect(payload.provider.message).toContain("automatically");
  });

  it("says NOT SUPPORTED for the verified text-to-image-only model", async () => {
    mocks.settings.mockResolvedValue({ provider: "together", model: "Qwen/Qwen-Image", hasApiKey: true, enabled: true });
    const payload = await (await GET()).json() as { provider: { capabilities: { supportsReferenceImages: boolean }; message: string } };
    expect(payload.provider.capabilities.supportsReferenceImages).toBe(false);
    expect(payload.provider.message).toContain("cannot directly condition");
  });

  it("reports the bundled fallback when no admin reference is active", async () => {
    const payload = await (await GET()).json() as {
      reference: { source: string; version: number; fallbackPath: string };
      bible: { protectedTraits: string[] };
    };
    expect(payload.reference.source).toBe("BUNDLED");
    expect(payload.reference.version).toBe(0);
    expect(payload.reference.fallbackPath).toBe("/assets/cabi-cpu-model.png");
    // The protected traits are listed so the console can show what is fixed.
    expect(payload.bible.protectedTraits.length).toBeGreaterThan(5);
  });
});

describe("the route is not site-mode gated", () => {
  it("is reachable while the site is still in PRELAUNCH, because the admin session is the authorization", async () => {
    // A prelaunch site must still be configurable: the reference is a product
    // asset, and there is no unfinished public surface here to withhold.
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("still refuses an unauthenticated caller in every mode", async () => {
    mocks.admin.mockResolvedValue({ session: null, response: Response.json({ error: "Admin sign-in required.", code: "ADMIN_UNAUTHORIZED" }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect((await POST(uploadRequest(pngBytes()))).status).toBe(401);
    expect((await PATCH(patchRequest({ activateId: "ref-1" }))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
