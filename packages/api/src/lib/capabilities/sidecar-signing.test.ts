import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizePayload,
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  definitionContentSha,
  parseCapabilitySignatureEnvelope,
  signCapabilitySidecar,
  verifyCapabilitySidecar,
} from "./sidecar-signing.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const otherPair = generateKeyPairSync("ed25519");

const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

const definition = "---\nname: firecrawl\ntype: api\n---\nFirecrawl.\n";
const sidecarBase = {
  slug: "firecrawl",
  class: "connection",
  enabled: true,
  permissions: { operations: ["scrape"] },
  updated_at: "2026-07-05T00:00:00.000Z",
};

function signedSidecar() {
  const { signed_content_sha, signature } = signCapabilitySidecar({
    signer,
    sidecar: sidecarBase,
    definitionBytes: definition,
    signedBy: "operator:user-123",
  });
  return { ...sidecarBase, signed_content_sha, signature };
}

describe("capability sidecar signing", () => {
  it("verify passes on an intact pair", () => {
    const result = verifyCapabilitySidecar({
      verifier,
      sidecar: signedSidecar(),
      definitionBytes: definition,
    });
    expect(result).toEqual({ ok: true });
  });

  it("fails definition_drift when definition bytes change", () => {
    const result = verifyCapabilitySidecar({
      verifier,
      sidecar: signedSidecar(),
      definitionBytes: definition + "\nedited after approval",
    });
    expect(result).toEqual({ ok: false, reason: "definition_drift" });
  });

  it("fails invalid_signature on a tampered sidecar payload", () => {
    const sidecar = signedSidecar();
    const tampered = {
      ...sidecar,
      permissions: { operations: ["scrape", "crawl_entire_site"] },
    };
    const result = verifyCapabilitySidecar({
      verifier,
      sidecar: tampered,
      definitionBytes: definition,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("fails invalid_signature on a missing or forged envelope", () => {
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar: sidecarBase,
        definitionBytes: definition,
      }),
    ).toEqual({ ok: false, reason: "invalid_signature" });

    // Signed with a different private key — the agent's own write tool
    // can produce shape-valid envelopes but never a verifying one.
    const forgedSigner = capabilitySignerFromKey(otherPair.privateKey);
    const forged = signCapabilitySidecar({
      signer: forgedSigner,
      sidecar: sidecarBase,
      definitionBytes: definition,
      signedBy: "operator:attacker",
    });
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar: { ...sidecarBase, ...forged },
        definitionBytes: definition,
      }),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("invalid_signature takes precedence when content also drifted", () => {
    const sidecar = signedSidecar();
    const tampered = { ...sidecar, enabled: false };
    const result = verifyCapabilitySidecar({
      verifier,
      sidecar: tampered,
      definitionBytes: "totally different bytes",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("canonicalization is key-order independent", () => {
    const a = canonicalizePayload({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const b = canonicalizePayload({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("generic payload signing covers the manifest envelope use (U2)", () => {
    const manifest = { agent: "ops", tools: [{ name: "x" }] };
    const envelope = signer.signPayload(manifest, { signedBy: "backfill" });
    expect(verifier.verifyPayload(manifest, envelope)).toBe(true);
    expect(
      verifier.verifyPayload({ ...manifest, tools: [] }, envelope),
    ).toBe(false);
  });

  it("parses only well-formed envelopes with known provenance", () => {
    const envelope = signer.signPayload(
      { x: 1 },
      { signedBy: "plugin-reconciler" },
    );
    expect(parseCapabilitySignatureEnvelope(envelope)?.signed_by).toBe(
      "plugin-reconciler",
    );
    expect(
      parseCapabilitySignatureEnvelope({ ...envelope, signed_by: "agent" }),
    ).toBeNull();
    expect(
      parseCapabilitySignatureEnvelope({ ...envelope, algorithm: "HMAC-SHA256" }),
    ).toBeNull();
    expect(
      parseCapabilitySignatureEnvelope({ ...envelope, signature: "short" }),
    ).toBeNull();
  });

  it("definitionContentSha is stable across Buffer/string input", () => {
    expect(definitionContentSha(definition)).toBe(
      definitionContentSha(Buffer.from(definition, "utf8")),
    );
  });
});
