/**
 * Approval execution-payload encryption (THINK-302 U11 — KTD-5).
 *
 * The parked-call ledger stores the minimized execution payload (tool name,
 * call id, arguments) encrypted at the application layer, so raw arguments
 * are unreadable at rest even to someone with DB access — only the resume
 * path decrypts them. This is app-layer AES-256-GCM with a platform key
 * resolved from Secrets Manager by the CALLER (U11b); the key is passed in
 * here so this module stays pure, config-free, and unit-testable.
 *
 * Envelope format (a single opaque string persisted in
 * `pending_tool_approvals.encrypted_payload`):
 *   v1.<base64url(iv)>.<base64url(authTag)>.<base64url(ciphertext)>
 * GCM binds the auth tag, so any tamper (or a wrong key) fails decryption
 * loudly rather than returning garbage.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const VERSION = "v1";

export class ApprovalPayloadCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalPayloadCryptoError";
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Normalize a caller-supplied key to exactly 32 bytes. Accepts a raw 32-byte
 * Buffer, or a base64/base64url/hex string that decodes to 32 bytes. Any
 * other length is rejected — never silently truncated or padded.
 */
export function normalizeApprovalPayloadKey(key: Buffer | string): Buffer {
  let buf: Buffer;
  if (Buffer.isBuffer(key)) {
    buf = key;
  } else if (/^[0-9a-fA-F]{64}$/.test(key)) {
    buf = Buffer.from(key, "hex");
  } else {
    // base64 / base64url both decode via the base64url decoder in Node when
    // padding is absent; try base64url first, then base64.
    buf = Buffer.from(key, "base64url");
    if (buf.length !== KEY_BYTES) buf = Buffer.from(key, "base64");
  }
  if (buf.length !== KEY_BYTES) {
    throw new ApprovalPayloadCryptoError(
      `approval payload key must decode to ${KEY_BYTES} bytes (got ${buf.length})`,
    );
  }
  return buf;
}

/** Encrypt a JSON-serializable execution payload into the opaque envelope. */
export function encryptApprovalPayload(
  payload: unknown,
  key: Buffer | string,
): string {
  const keyBuf = normalizeApprovalPayloadKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyBuf, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, b64url(iv), b64url(authTag), b64url(ciphertext)].join(".");
}

/**
 * Decrypt an envelope back to the parsed payload. Throws on a malformed
 * envelope, an unknown version, a wrong key, or any tamper (GCM auth
 * failure) — never returns partial or garbage data.
 */
export function decryptApprovalPayload<T = unknown>(
  envelope: string,
  key: Buffer | string,
): T {
  const parts = envelope.split(".");
  if (parts.length !== 4) {
    throw new ApprovalPayloadCryptoError("malformed approval payload envelope");
  }
  const [version, ivB64, tagB64, ctB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(VERSION);
  const got = Buffer.from(version);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new ApprovalPayloadCryptoError(
      `unsupported approval payload envelope version '${version}'`,
    );
  }
  const keyBuf = normalizeApprovalPayloadKey(key);
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  if (iv.length !== IV_BYTES) {
    throw new ApprovalPayloadCryptoError("bad iv length in envelope");
  }
  const decipher = createDecipheriv(ALGO, keyBuf, iv);
  decipher.setAuthTag(authTag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM auth failure (tamper or wrong key) — fail closed, no detail leak.
    throw new ApprovalPayloadCryptoError(
      "approval payload failed authenticated decryption (tamper or wrong key)",
    );
  }
  return JSON.parse(plaintext.toString("utf8")) as T;
}
