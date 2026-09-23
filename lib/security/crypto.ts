import "server-only";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64ToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signValue(value: string, secret: string) {
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value));
  return `${bytesToBase64(encoder.encode(value))}.${bytesToBase64(new Uint8Array(signature))}`;
}

export async function verifySignedValue(token: string, secret: string): Promise<string | null> {
  const [payload, expected, ...rest] = token.split(".");
  if (!payload || !expected || rest.length) return null;
  try {
    const value = decoder.decode(base64ToBytes(payload));
    const actual = bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value))));
    return constantTimeEqual(actual, expected) ? value : null;
  } catch {
    return null;
  }
}

export type SecretEnvelope = { version: 1; algorithm: "A256GCM"; keyId: string; iv: string; ciphertext: string };

async function importEncryptionKey(base64Key: string, usage: KeyUsage[]) {
  const key = base64ToBytes(base64Key);
  if (key.byteLength !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, usage);
}

export async function encryptSecret(plaintext: string, base64Key: string, aad: string, keyId = "primary"): Promise<SecretEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad), tagLength: 128 }, await importEncryptionKey(base64Key, ["encrypt"]), encoder.encode(plaintext));
  return { version: 1, algorithm: "A256GCM", keyId, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSecret(envelope: SecretEnvelope, base64Key: string, aad: string) {
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM") throw new Error("Unsupported secret envelope.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: encoder.encode(aad), tagLength: 128 }, await importEncryptionKey(base64Key, ["decrypt"]), base64ToBytes(envelope.ciphertext));
  return decoder.decode(plaintext);
}

export async function hashValue(value: string) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function verifyPbkdf2Password(password: string, encoded: string) {
  const [algorithm, iterationsRaw, salt, expected] = encoded.split("$");
  const iterations = Number(iterationsRaw);
  if (algorithm !== "pbkdf2-sha256" || !Number.isSafeInteger(iterations) || iterations < 100_000 || !salt || !expected) return false;
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations }, material, 256);
  return constantTimeEqual(bytesToBase64(new Uint8Array(bits)), expected);
}

export const base64 = { encode: bytesToBase64, decode: base64ToBytes };
