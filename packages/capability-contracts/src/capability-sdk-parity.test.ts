import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey, verify as edVerify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  type CanonicalJson,
  canonicalize,
  canonicalSha256Hex,
} from "./canonical";
import { buildSignableCallPayload } from "./session";

/**
 * Cross-language parity (THINK-280 U4). The committed `shared-vectors.json` is the
 * single source of truth both this TypeScript test and the Python
 * `test_canonical.py` / `test_ed25519.py` assert against. When BOTH sides match the
 * SAME committed expected values, the Node canonicalizer and the pure-stdlib Python
 * canonicalizer produce byte-identical output, and a signature the Python SDK
 * computes verifies here under `node:crypto` — the exact path the broker uses.
 *
 * The vectors live beside the Python SDK; read them by relative path.
 */
const VECTORS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "agentcore-pi",
  "agent-container",
  "src",
  "runtime",
  "capability-sdk",
  "shared-vectors.json",
);

interface CanonicalVector {
  name: string;
  value: unknown;
  canonical: string;
  sha256Hex: string;
}
interface SignatureVector {
  name: string;
  kind: "raw" | "call";
  seedHex: string;
  messageHex?: string;
  audience?: string;
  request?: {
    sessionId: string;
    clientRequestId: string;
    sequence: number;
    nonce: string;
    issuedAt: string;
    operation: string;
    input: CanonicalJson;
  };
  signableString?: string;
  publicKeySpkiB64: string;
  signatureB64: string;
  signatureHex: string;
}
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as {
  canonical: CanonicalVector[];
  signatures: SignatureVector[];
};

function spkiKey(b64: string) {
  return createPublicKey({
    key: Buffer.from(b64, "base64"),
    format: "der",
    type: "spki",
  });
}

describe("capability-sdk canonical parity (TS side)", () => {
  it("has vectors to check", () => {
    expect(vectors.canonical.length).toBeGreaterThan(0);
  });

  for (const vector of vectors.canonical) {
    it(`canonicalizes "${vector.name}" to the committed bytes`, () => {
      expect(canonicalize(vector.value)).toBe(vector.canonical);
      expect(canonicalSha256Hex(vector.value)).toBe(vector.sha256Hex);
    });
  }
});

describe("capability-sdk signature parity (Python-sign -> Node-verify)", () => {
  const raw = vectors.signatures.filter((v) => v.kind === "raw");
  const call = vectors.signatures.find((v) => v.kind === "call");

  it("has RFC 8032 raw vectors and a call-payload vector", () => {
    expect(raw.length).toBeGreaterThanOrEqual(3);
    expect(call).toBeDefined();
  });

  for (const vector of raw) {
    it(`node:crypto verifies the committed signature for ${vector.name}`, () => {
      const message = Buffer.from(vector.messageHex ?? "", "hex");
      const signature = Buffer.from(vector.signatureB64, "base64");
      // The committed signature is exactly what the Python signer produces
      // (asserted by test_ed25519.py). Node accepting it proves the roundtrip.
      expect(
        edVerify(null, message, spkiKey(vector.publicKeySpkiB64), signature),
      ).toBe(true);
      // A flipped bit must fail closed.
      const tampered = Buffer.from(signature);
      tampered[0] ^= 0x01;
      expect(
        edVerify(null, message, spkiKey(vector.publicKeySpkiB64), tampered),
      ).toBe(false);
    });
  }

  it("rebuilds the call signable via buildSignableCallPayload and node-verifies", () => {
    expect(call).toBeDefined();
    if (!call || !call.request || !call.audience) return;
    // The signable string the SDK signs must equal buildSignableCallPayload's output.
    const rebuilt = buildSignableCallPayload(call.audience, call.request);
    expect(rebuilt).toBe(call.signableString);

    // node:crypto verifies the committed (Python-produced) signature over those bytes.
    const signature = Buffer.from(call.signatureB64, "base64");
    expect(
      edVerify(
        null,
        Buffer.from(rebuilt, "utf8"),
        spkiKey(call.publicKeySpkiB64),
        signature,
      ),
    ).toBe(true);
  });
});
