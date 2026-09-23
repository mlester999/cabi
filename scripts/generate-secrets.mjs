import { pbkdf2Sync, randomBytes } from "node:crypto";

function base64url(value) { return Buffer.from(value).toString("base64url"); }

console.log(`APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`SESSION_SECRET=${base64url(randomBytes(48))}`);

const password = process.env.CABI_ADMIN_PASSWORD;
if (password) {
  if (password.length < 12) throw new Error("CABI_ADMIN_PASSWORD must be at least 12 characters.");
  const iterations = 310_000;
  const salt = randomBytes(18);
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  console.log(`ADMIN_PASSWORD_HASH=pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(hash)}`);
} else {
  console.log("# Set CABI_ADMIN_PASSWORD temporarily and rerun to generate ADMIN_PASSWORD_HASH.");
}
