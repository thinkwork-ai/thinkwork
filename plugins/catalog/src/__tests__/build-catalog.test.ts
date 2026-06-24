import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildSignedCatalogJson } from "../../scripts/build-catalog";
import { verifyPluginCatalog } from "../catalog";
import { allPluginManifests } from "../registry";

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string,
    privateKeyPem: pair.privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
  };
}

describe("buildSignedCatalogJson", () => {
  it("produces a JSON document that verifies against the signing key", () => {
    const keys = keyPair();
    const json = buildSignedCatalogJson({
      manifests: allPluginManifests,
      privateKeyPem: keys.privateKeyPem,
      generatedAt: "2026-06-12T00:00:00.000Z",
    });
    const document = JSON.parse(json) as unknown;
    const verified = verifyPluginCatalog({
      document,
      trustedPublicKeyPem: keys.publicKeyPem,
    });
    expect(verified.plugins.map((plugin) => plugin.pluginKey)).toEqual([
      "company-brain",
      "company-data",
      "company-etl",
      "lastmile",
      "n8n",
      "email-channel",
      "sendgrid",
      "twenty",
      "workos-auth",
    ]);
    expect(verified.generatedAt).toBe("2026-06-12T00:00:00.000Z");
  });

  it("includes source provenance when provided by the publisher", () => {
    const keys = keyPair();
    const json = buildSignedCatalogJson({
      manifests: allPluginManifests,
      privateKeyPem: keys.privateKeyPem,
      generatedAt: "2026-06-12T00:00:00.000Z",
      source: {
        repository: "thinkwork-ai/thinkwork",
        ref: "main",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
      },
    });
    const verified = verifyPluginCatalog({
      document: JSON.parse(json) as unknown,
      trustedPublicKeyPem: keys.publicKeyPem,
    });
    expect(verified.source).toEqual({
      repository: "thinkwork-ai/thinkwork",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("fails verification against a different key", () => {
    const signing = keyPair();
    const other = keyPair();
    const json = buildSignedCatalogJson({
      manifests: allPluginManifests,
      privateKeyPem: signing.privateKeyPem,
    });
    expect(() =>
      verifyPluginCatalog({
        document: JSON.parse(json) as unknown,
        trustedPublicKeyPem: other.publicKeyPem,
      }),
    ).toThrow(/signature is invalid/);
  });
});
