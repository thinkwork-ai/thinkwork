/**
 * Confidential-client secret hashing for capability external M2M clients
 * (THINK-280 U8).
 *
 * The operator-created client secret is revealed exactly once at creation and
 * then stored ONLY as a slow (scrypt) hash. Verification is constant-time.
 * Format: `scrypt$<N>$<r>$<p>$<saltB64Url>$<hashB64Url>` — self-describing so
 * cost parameters can evolve without a migration.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384; // CPU/memory cost (2^14)
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
const SECRET_BYTES = 32;

/** Generate a fresh URL-safe client secret to reveal once. */
export function generateClientSecret(): string {
  return `twcs_${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/** Slow-hash a secret for at-rest storage. */
export function hashClientSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, KEYLEN, { N, r: R, p: P });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/** Constant-time verify a presented secret against a stored slow hash. */
export function verifyClientSecret(secret: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const derived = scryptSync(secret, salt, expected.length, { N: n, r, p });
    return (
      derived.length === expected.length && timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}
