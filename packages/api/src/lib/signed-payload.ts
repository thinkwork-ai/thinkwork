/**
 * Generic signed-state primitive shared by the Slack OAuth install state and
 * the Microsoft Teams install-state / account-link-token helpers.
 *
 * Format: base64url(JSON payload) + "." + HMAC-SHA256(base64url) over the
 * encoded payload. Verification uses a constant-time signature compare and
 * enforces payload shape + expiry. The signing key is transport-only secret
 * material (a provider client_secret) — never log it and never return it.
 *
 * Error messages are `${errorPrefix} <suffix>` so each call site keeps its
 * exact historical, user-visible error strings.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySignedPayloadOptions<T> {
  /** Shape guard for the decoded JSON payload. */
  validate: (value: unknown) => value is T;
  /**
   * Prefix for every error message, e.g. "Slack install state" or
   * "Teams account-link token".
   */
  errorPrefix: string;
  /** Extracts the expiry (epoch ms) from a validated payload. */
  expiresAt: (payload: T) => number;
  nowMs?: () => number;
}

export function createSignedPayload<T>(payload: T, signingKey: string): string {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, signingKey)}`;
}

export function verifySignedPayload<T>(
  state: string,
  signingKey: string,
  options: VerifySignedPayloadOptions<T>,
): T {
  const { validate, errorPrefix, expiresAt, nowMs = Date.now } = options;

  const [encoded, actualSignature, extra] = state.split(".");
  if (!encoded || !actualSignature || extra !== undefined) {
    throw new Error(`${errorPrefix} is malformed`);
  }

  const expectedSignature = sign(encoded, signingKey);
  if (!constantTimeEqual(actualSignature, expectedSignature)) {
    throw new Error(`${errorPrefix} signature is invalid`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new Error(`${errorPrefix} payload is invalid`);
  }
  if (!validate(parsed)) {
    throw new Error(`${errorPrefix} payload is incomplete`);
  }
  if (expiresAt(parsed) < nowMs()) {
    throw new Error(`${errorPrefix} has expired`);
  }
  return parsed;
}

function sign(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
