import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The generation route, end to end on the server plane.
 *
 * What this suite protects:
 *
 * - the assembled prompt carries the fixed identity, so a scene cannot replace it,
 * - the official reference is attached automatically when the model supports it,
 *   and is never sent when it does not,
 * - a client cannot supply or override the reference,
 * - the safe metadata (reference version, expression, outfit) is recorded and the
 *   prompt layers are not.
 */

const mocks = vi.hoisted(() => ({
  generated: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  reference: { source: "BUNDLED" as string, version: 0, path: "/assets/cabi-cpu-model.png", mimeType: "image/png", width: 500, height: 500, bytes: null as Uint8Array | null, signedUrl: null as string | null, conditionable: false },
  bible: { artDirection: "", negative: "", customized: false },
  providerModel: "Qwen/Qwen-Image-2.0",
  providerId: "together",
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      const chain = () => query;
      query.select = chain;
      query.eq = chain;
      query.order = chain;
      query.limit = chain;
      query.is = chain;
      query.not = chain;
      query.maybeSingle = async () => ({ data: null, error: null });
      query.insert = (value: Record<string, unknown>) => {
        if (table === "image_generations") mocks.inserted.push(value);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: value.id ?? "row", created_at: new Date().toISOString() }, error: null }) }) };
      };
      query.update = () => ({ eq: () => ({ eq: async () => ({ error: null }) }) });
      query.then = (resolve: (result: unknown) => unknown) => resolve({ data: [], error: null });
      return query;
    },
    rpc: async () => ({ data: [{ allowed: true, remaining: 5 }], error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://storage.example/signed/image.png" }, error: null }),
        download: async () => ({ data: null, error: { message: "missing" } }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

vi.mock("@/lib/site/guard", () => ({ guardAppApiCpu: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/wallet/session", () => ({
  readWalletAuth: async () => ({
    sessionId: "s",
    walletAccountId: "11111111-1111-1111-1111-111111111111",
    profileId: "p",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletAddressUniqueKey: "0x1111111111111111111111111111111111111111",
    expiresAt: "",
  }),
}));
vi.mock("@/lib/image-generation/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-generation/settings")>();
  return {
    ...actual,
    readImageProviderConfig: async () => ({
      settings: {
        enabled: true,
        provider: mocks.providerId,
        baseUrl: "",
        model: mocks.providerModel,
        defaultAspectRatio: "1:1",
        defaultQuality: "standard",
        dailyLimit: 5,
        allowGuestGeneration: false,
      },
      apiKey: "test-key-not-real",
    }),
  };
});
vi.mock("@/lib/cabi/reference/resolve.server", () => ({ resolveCabiReference: async () => mocks.reference }));
vi.mock("@/lib/cabi/character-bible.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cabi/character-bible.server")>();
  return { ...actual, readCabiCharacterBible: async () => mocks.bible };
});
vi.mock("@/lib/image-generation/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-generation/provider")>();
  return {
    ...actual,
    createImageProvider: () => ({
      id: "together",
      label: "Together AI",
      supportsReferenceImage: true,
      capabilities: { supportsReferenceImages: true, supportsImageToImage: true, supportsSeed: true },
      async generateCabiImage(input: Record<string, unknown>) {
        mocks.generated.push(input);
        return {
          ok: true,
          image: { bytes: new Uint8Array(256).fill(4), contentType: "image/png", provider: "together", model: mocks.providerModel, width: 1024, height: 1024 },
        };
      },
      async testConnection() { return { ok: true, model: mocks.providerModel, message: "Connected." }; },
    }),
  };
});

import { POST } from "@/app/api/images/generate/route";
import { cabiCanonicalIdentity } from "@/lib/cabi/image-identity";

function request(body: unknown) {
  return new Request("http://localhost:5173/api/images/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.generated.length = 0;
  mocks.inserted.length = 0;
  mocks.providerModel = "Qwen/Qwen-Image-2.0";
  mocks.providerId = "together";
  mocks.reference = { source: "BUNDLED", version: 0, path: "/assets/cabi-cpu-model.png", mimeType: "image/png", width: 500, height: 500, bytes: null, signedUrl: null, conditionable: false };
  mocks.bible = { artDirection: "", negative: "", customized: false };
});

describe("the prompt always carries the fixed identity", () => {
  it("assembles the identity layers for a plain scene", async () => {
    const response = await POST(request({ prompt: "Cabi at the beach", aspectRatio: "1:1" }));
    expect(response.status).toBe(200);
    expect(mocks.generated).toHaveLength(1);
    const prompt = String(mocks.generated[0].preparedPrompt);
    expect(prompt).toContain(cabiCanonicalIdentity);
    expect(prompt).toContain("Scene: Cabi at the beach");
  });

  it("strips an attempt to redefine Cabi while keeping her identity", async () => {
    await POST(request({ prompt: "Make Cabi blonde with blue eyes and remove her cat ears", aspectRatio: "1:1" }));
    const prompt = String(mocks.generated[0].preparedPrompt);
    expect(prompt).toContain(cabiCanonicalIdentity);
    expect(prompt.toLowerCase()).not.toContain("blonde with blue eyes");
  });

  it("appends owner art direction to composition, not to identity", async () => {
    mocks.bible = { artDirection: "soft watercolour finish", negative: "", customized: true };
    await POST(request({ prompt: "Cabi reading", aspectRatio: "1:1" }));
    const prompt = String(mocks.generated[0].preparedPrompt);
    expect(prompt).toContain("soft watercolour finish");
    expect(prompt.indexOf(cabiCanonicalIdentity)).toBe(0);
  });
});

describe("the official reference is used automatically", () => {
  it("attaches the active reference for a reference-capable model with no user action", async () => {
    mocks.providerModel = "Qwen/Qwen-Image-2.0-Pro";
    mocks.reference = {
      source: "ADMIN_UPLOAD",
      version: 3,
      path: "official/cabi-reference.png",
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      bytes: new Uint8Array(64).fill(7),
      signedUrl: "https://storage.example/signed/reference.png",
      conditionable: true,
    };
    await POST(request({ prompt: "Cabi in a hoodie", aspectRatio: "1:1" }));
    const passed = mocks.generated[0];
    expect(Array.isArray(passed.referenceImages)).toBe(true);
    // A data URL built from the stored bytes, so the provider needs no access to
    // the private bucket.
    expect(String((passed.referenceImages as string[])[0])).toMatch(/^data:image\/png;base64,/u);
    // And the reference version is recorded on the row.
    const completed = mocks.inserted.find((row) => row.status === "COMPLETED");
    expect(completed?.reference_version).toBe(3);
    expect(completed?.reference_conditioned).toBe(true);
  });

  it("never sends a reference parameter to a text-to-image model", async () => {
    mocks.providerModel = "Qwen/Qwen-Image";
    mocks.reference = {
      source: "ADMIN_UPLOAD",
      version: 4,
      path: "official/cabi-reference.png",
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      bytes: new Uint8Array(64).fill(7),
      signedUrl: "https://storage.example/signed/reference.png",
      conditionable: true,
    };
    await POST(request({ prompt: "Cabi in a hoodie", aspectRatio: "1:1" }));
    // The reference is stored and used as the canonical identity asset, but the
    // request must not carry a parameter the model cannot honour.
    expect(mocks.generated[0].referenceImages).toBeUndefined();
    const completed = mocks.inserted.find((row) => row.status === "COMPLETED");
    expect(completed?.reference_version).toBe(4);
    expect(completed?.reference_conditioned).toBe(false);
  });

  it("records the bundled fallback as version 0 and attaches it for the default model", async () => {
    await POST(request({ prompt: "Cabi waving", aspectRatio: "1:1" }));
    const completed = mocks.inserted.find((row) => row.status === "COMPLETED");
    expect(completed?.reference_version).toBe(0);
    expect(String((mocks.generated[0].referenceImages as string[])[0])).toContain("cabi-cpu-model.png");
    expect(completed?.reference_conditioned).toBe(true);
  });
});

describe("a client cannot supply or override the reference", () => {
  it("ignores reference fields in the request body", async () => {
    mocks.providerModel = "Qwen/Qwen-Image-2.0-Pro";
    await POST(request({
      prompt: "Cabi in a hoodie",
      aspectRatio: "1:1",
      referenceImage: "https://evil.example/other-character.png",
      referenceImages: ["https://evil.example/other-character.png"],
      referenceVersion: 99,
    }));
    const passed = mocks.generated[0];
    // The bundled reference is what the server resolved, not what the client sent.
    const sent = passed.referenceImages as string[] | undefined;
    if (sent) {
      for (const value of sent) expect(value).not.toContain("evil.example");
    }
    const completed = mocks.inserted.find((row) => row.status === "COMPLETED");
    expect(completed?.reference_version).toBe(0);
  });

  it("rejects an unknown expression or outfit rather than passing it through", async () => {
    await POST(request({ prompt: "Cabi smiling", aspectRatio: "1:1", expression: "smouldering", outfit: "mech suit" }));
    const prompt = String(mocks.generated[0].preparedPrompt);
    expect(prompt).not.toContain("smouldering");
    expect(prompt).not.toContain("mech suit");
  });
});

describe("generation metadata is safe", () => {
  it("records the varied attributes and never the prompt layers", async () => {
    await POST(request({ prompt: "Cabi smiling in a black hoodie at night", aspectRatio: "1:1" }));
    const completed = mocks.inserted.find((row) => row.status === "COMPLETED");
    expect(completed).toBeDefined();
    const serialized = JSON.stringify(completed);
    // No identity text, no assembled prompt, no reference path.
    expect(serialized).not.toContain("young-adult anime cat-girl");
    expect(serialized).not.toContain("official/cabi-reference");
    expect(serialized).not.toContain("preparedPrompt");
    // The scene is stored because the user wrote it.
    expect(String(completed?.scene ?? "")).toContain("hoodie");
  });

  it("keeps the response free of provider and reference internals", async () => {
    const response = await POST(request({ prompt: "Cabi reading", aspectRatio: "1:1" }));
    const payload = await response.json() as { image?: Record<string, unknown> };
    expect(payload.image).toBeDefined();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Qwen");
    expect(serialized).not.toContain("cabi-reference");
    expect(serialized).not.toContain("referenceImages");
    expect(serialized).not.toContain(cabiCanonicalIdentity);
  });
});
