import { describe, expect, it } from "vitest";
import { base64, decryptSecret, encryptSecret, signValue, verifySignedValue } from "@/lib/security/crypto";

describe("server cryptography", () => {
  it("round trips an AES-256-GCM secret and binds AAD", async () => {
    const key = base64.encode(crypto.getRandomValues(new Uint8Array(32)));
    const envelope = await encryptSecret("sk-super-secret", key, "record:one");
    expect(envelope.ciphertext).not.toContain("super-secret");
    await expect(decryptSecret(envelope, key, "record:one")).resolves.toBe("sk-super-secret");
    await expect(decryptSecret(envelope, key, "record:two")).rejects.toBeDefined();
  });

  it("rejects tampered ciphertext", async () => {
    const key = base64.encode(crypto.getRandomValues(new Uint8Array(32)));
    const envelope = await encryptSecret("secret", key, "aad");
    const bytes = base64.decode(envelope.ciphertext); bytes[0] ^= 1;
    await expect(decryptSecret({ ...envelope, ciphertext: base64.encode(bytes) }, key, "aad")).rejects.toBeDefined();
  });

  it("signs guest values and rejects forgeries", async () => {
    const token = await signValue("profile-id", "session-secret");
    await expect(verifySignedValue(token, "session-secret")).resolves.toBe("profile-id");
    await expect(verifySignedValue(`${token}x`, "session-secret")).resolves.toBeNull();
    await expect(verifySignedValue(token, "different-secret")).resolves.toBeNull();
  });
});
