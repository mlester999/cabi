import { describe, expect, it } from "vitest";

import {
  avatarMaxBytes,
  avatarPath,
  generationBucket,
  avatarBucket,
  generationPath,
  stripJpegMetadata,
  validateAvatarBytes,
} from "@/lib/image-generation/storage";

function png(size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}
function jpeg(size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}
function webp(size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0);
  return bytes;
}

describe("avatar upload validation", () => {
  it("accepts the three allowed formats by magic bytes", () => {
    expect(validateAvatarBytes(png())).toEqual({ ok: true, contentType: "image/png", extension: "png" });
    expect(validateAvatarBytes(jpeg())).toEqual({ ok: true, contentType: "image/jpeg", extension: "jpg" });
    expect(validateAvatarBytes(webp())).toEqual({ ok: true, contentType: "image/webp", extension: "webp" });
  });

  it("rejects a renamed non-image file", () => {
    // An executable, or any other format, cannot masquerade as a PNG.
    const notAnImage = new Uint8Array(64);
    notAnImage.set([0x4d, 0x5a, 0x90, 0x00], 0);
    const result = validateAvatarBytes(notAnImage);
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized upload before anything is stored", () => {
    const result = validateAvatarBytes(png(avatarMaxBytes + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too large/i);
  });

  it("rejects empty and truncated files", () => {
    expect(validateAvatarBytes(new Uint8Array(0)).ok).toBe(false);
    expect(validateAvatarBytes(new Uint8Array(4)).ok).toBe(false);
  });

  it("gives a human message for every rejection", () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(8), png(avatarMaxBytes + 1)]) {
      const result = validateAvatarBytes(bytes);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    }
  });
});

describe("object paths", () => {
  it("scopes paths by wallet so one user cannot target another's object", () => {
    const path = generationPath("wallet-a", "gen-1", "png");
    expect(path.startsWith("wallet-a/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("rejects a suspicious extension instead of embedding it", () => {
    expect(generationPath("wallet-a", "gen-1", "../../etc/passwd")).toBe("wallet-a/gen-1.png");
    // Active-content extensions must never survive into an object path.
    expect(generationPath("wallet-a", "gen-1", "html")).toBe("wallet-a/gen-1.png");
    expect(generationPath("wallet-a", "gen-1", "svg")).toBe("wallet-a/gen-1.png");
    expect(avatarPath("wallet-a", "svg")).toBe("wallet-a/avatar.png");
  });

  it("keeps avatars on a stable per-wallet path so uploads replace cleanly", () => {
    expect(avatarPath("wallet-a", "jpg")).toBe("wallet-a/avatar.jpg");
    expect(avatarPath("wallet-a", "nope")).toBe("wallet-a/avatar.png");
  });

  it("uses separate private buckets for generations and avatars", () => {
    expect(generationBucket).toBe("cabi-generations");
    expect(avatarBucket).toBe("avatars");
    expect(generationBucket).not.toBe(avatarBucket);
  });
});

describe("avatar metadata stripping", () => {
  it("removes an APP1 EXIF segment from a JPEG", () => {
    // FF D8 | APP1(len 0x0010) payload | SOS marker
    const segments = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x10, ...new Array(14).fill(0x41),
      0xff, 0xda, 0x00, 0x08, ...new Array(6).fill(0x42),
    ]);
    const stripped = stripJpegMetadata(segments);
    expect(stripped.byteLength).toBeLessThan(segments.byteLength);
    // The EXIF payload must be gone.
    expect(Array.from(stripped).filter((byte) => byte === 0x41)).toHaveLength(0);
    // The scan data must survive.
    expect(Array.from(stripped).filter((byte) => byte === 0x42).length).toBeGreaterThan(0);
  });

  it("leaves a PNG untouched, since PNG has no EXIF container here", () => {
    const input = png(32);
    expect(stripJpegMetadata(input)).toBe(input);
  });

  it("does not corrupt a JPEG with no metadata", () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22]);
    expect(stripJpegMetadata(plain).byteLength).toBe(plain.byteLength);
  });
});