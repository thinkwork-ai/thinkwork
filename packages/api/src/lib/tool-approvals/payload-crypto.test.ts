/**
 * Approval payload crypto tests (THINK-302 U11 — KTD-5).
 * The point: raw args are unreadable at rest; tamper/wrong-key fail closed.
 */

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApprovalPayloadCryptoError,
  decryptApprovalPayload,
  encryptApprovalPayload,
  normalizeApprovalPayloadKey,
} from "./payload-crypto.js";

const key = randomBytes(32);

const payload = {
  toolName: "dagster_launch_run",
  callId: "toolu_1",
  arguments: { pipeline: "nightly_etl", token: "ghp_secret_value_1234567890" },
};

describe("encrypt/decrypt round-trip", () => {
  it("round-trips a payload exactly", () => {
    const env = encryptApprovalPayload(payload, key);
    expect(decryptApprovalPayload(env, key)).toEqual(payload);
  });

  it("the envelope contains no plaintext argument values (unreadable at rest)", () => {
    const env = encryptApprovalPayload(payload, key);
    expect(env).not.toContain("nightly_etl");
    expect(env).not.toContain("ghp_secret_value");
    expect(env.startsWith("v1.")).toBe(true);
  });

  it("two encryptions of the same payload differ (random IV)", () => {
    expect(encryptApprovalPayload(payload, key)).not.toBe(
      encryptApprovalPayload(payload, key),
    );
  });

  it("accepts hex / base64 / base64url key encodings", () => {
    const env = encryptApprovalPayload(payload, key.toString("hex"));
    expect(decryptApprovalPayload(env, key.toString("base64"))).toEqual(
      payload,
    );
    expect(decryptApprovalPayload(env, key.toString("base64url"))).toEqual(
      payload,
    );
  });
});

describe("fail-closed", () => {
  it("a wrong key fails authenticated decryption", () => {
    const env = encryptApprovalPayload(payload, key);
    expect(() => decryptApprovalPayload(env, randomBytes(32))).toThrow(
      ApprovalPayloadCryptoError,
    );
  });

  it("tampered ciphertext fails the GCM auth check", () => {
    const env = encryptApprovalPayload(payload, key);
    const parts = env.split(".");
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decryptApprovalPayload(parts.join("."), key)).toThrow(
      /authenticated decryption/,
    );
  });

  it("rejects a malformed envelope", () => {
    expect(() => decryptApprovalPayload("not-an-envelope", key)).toThrow(
      /malformed/,
    );
  });

  it("rejects an unknown envelope version", () => {
    const env = encryptApprovalPayload(payload, key);
    const bumped = env.replace(/^v1\./, "v2.");
    expect(() => decryptApprovalPayload(bumped, key)).toThrow(/version/);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => normalizeApprovalPayloadKey(randomBytes(16))).toThrow(
      /32 bytes/,
    );
    expect(() => encryptApprovalPayload(payload, "tooshort")).toThrow(
      ApprovalPayloadCryptoError,
    );
  });
});
