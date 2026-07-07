/**
 * Artifact share-link tokens (THINK-208).
 *
 * The public share URL carries `base64url(shareId) + "." + HMAC-SHA256(shareId)`.
 * No token material is stored at rest — the DB holds only the share id, and
 * the URL is re-derivable at any time by re-signing it (which is what makes
 * mint's get-or-create return a working URL for an existing share). A DB read
 * alone cannot forge a token; the signing secret lives with the deployed
 * handler environment.
 *
 * Verification never throws distinguishable errors: any malformation or
 * signature mismatch returns null so the public route can collapse every
 * miss to the same 404.
 */

import { getApiAuthSecret } from "@thinkwork/runtime-config";
import { createHmac, timingSafeEqual } from "node:crypto";

function shareHmacSecret(): string {
  // getApiAuthSecret returns "" when unresolved; an empty HMAC key would
  // make every token forgeable, so fail closed instead.
  const secret = getApiAuthSecret();
  if (!secret) throw new Error("share token secret unresolved");
  return secret;
}

function sign(shareId: string): string {
  return createHmac("sha256", shareHmacSecret())
    .update(shareId)
    .digest("base64url");
}

/** Produce the URL token for a share row id. Deterministic per id + secret. */
export function signShareToken(shareId: string): string {
  const encoded = Buffer.from(shareId, "utf-8").toString("base64url");
  return `${encoded}.${sign(shareId)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify a share token's HMAC signature (timing-safe) and return the share
 * id, or null on any malformation or mismatch.
 */
export function verifyShareToken(token: string): string | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 256) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, providedSig] = parts;

  let shareId: string;
  try {
    shareId = Buffer.from(encoded, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  if (!UUID_RE.test(shareId)) return null;

  try {
    const sigA = Buffer.from(providedSig, "base64url");
    const sigB = Buffer.from(sign(shareId), "base64url");
    if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
      return null;
    }
  } catch {
    // Unresolved secret (or any crypto failure) fails closed.
    return null;
  }
  return shareId;
}
