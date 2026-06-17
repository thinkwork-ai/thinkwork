import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PluginCatalogDigestError,
  PluginCatalogError,
  PluginCatalogSchemaError,
  PluginCatalogSignatureError,
  buildPluginCatalog,
  pluginCatalogSha256,
  signPluginCatalog,
  verifyPluginCatalog,
  type SignedPluginCatalogDocument,
} from "../catalog";
import { companyBrainManifest, lastmileManifest } from "../registry";

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function signedDocument(privateKeyPem: string): SignedPluginCatalogDocument {
  const catalog = buildPluginCatalog({
    manifests: [lastmileManifest],
    generatedAt: "2026-06-12T00:00:00.000Z",
    source: {
      repository: "thinkwork-ai/thinkwork",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
    },
  });
  return signPluginCatalog({
    catalog,
    privateKeyPem,
    signedAt: "2026-06-12T00:00:00.000Z",
  });
}

describe("buildPluginCatalog", () => {
  it("builds an entry per manifest with per-version payload digests", () => {
    const catalog = buildPluginCatalog({ manifests: [lastmileManifest] });
    expect(catalog.schemaVersion).toBe(PLUGIN_CATALOG_SCHEMA_VERSION);
    expect(catalog.plugins).toHaveLength(1);
    const entry = catalog.plugins[0];
    expect(entry.pluginKey).toBe("lastmile");
    expect(entry.versions[0].version).toBe("0.1.0");
    expect(entry.versions[0].payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.versions[0].payload).toEqual(lastmileManifest.versions[0]);
  });

  it("optionally signs GitHub source provenance", () => {
    const catalog = buildPluginCatalog({
      manifests: [lastmileManifest],
      generatedAt: "2026-06-12T00:00:00.000Z",
      source: {
        repository: "thinkwork-ai/thinkwork",
        ref: "refs/heads/main",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
      },
    });
    expect(catalog.source).toEqual({
      repository: "thinkwork-ai/thinkwork",
      ref: "refs/heads/main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("keeps source provenance optional for bundled fallback catalogs", () => {
    const catalog = buildPluginCatalog({
      manifests: [lastmileManifest],
      generatedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(catalog.source).toBeUndefined();
  });

  it("rejects duplicate plugin keys in a catalog", () => {
    expect(() =>
      buildPluginCatalog({ manifests: [lastmileManifest, lastmileManifest] }),
    ).toThrow(/Duplicate plugin key in catalog: lastmile/);
  });

  it("preserves premium metadata on catalog entries", () => {
    const catalog = buildPluginCatalog({ manifests: [companyBrainManifest] });
    expect(catalog.plugins[0].pluginKey).toBe("company-brain");
    expect(catalog.plugins[0].premium).toEqual({
      entitlementProductKey: "company-brain",
      installKeyRequired: true,
      installKeyPrompt:
        "Enter the Company Brain install key provided by ThinkWork to unlock this premium plugin for your tenant.",
    });
  });

  it("rejects invalid manifests", () => {
    const bad = clone(lastmileManifest);
    bad.versions[0].version = "not-semver";
    expect(() => buildPluginCatalog({ manifests: [bad] })).toThrow(
      /not valid semver/,
    );
  });

  it("rejects invalid source provenance shape", () => {
    expect(() =>
      buildPluginCatalog({
        manifests: [lastmileManifest],
        source: {
          repository: "not-owner-name",
          ref: "main",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
        },
      }),
    ).toThrow(/owner\/name/);
    expect(() =>
      buildPluginCatalog({
        manifests: [lastmileManifest],
        source: {
          repository: "thinkwork-ai/thinkwork",
          ref: "main",
          commitSha: "not-a-sha",
        },
      }),
    ).toThrow(/40-character Git commit SHA/);
  });
});

describe("sign → verify round-trip", () => {
  it("verifies a signed catalog with the matching public key", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const verified = verifyPluginCatalog({
      document,
      trustedPublicKeyPem: keys.publicKeyPem,
    });
    expect(verified.plugins[0].pluginKey).toBe("lastmile");
    expect(verified.source).toEqual({
      repository: "thinkwork-ai/thinkwork",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(document.signature.catalogSha256).toBe(
      pluginCatalogSha256(verified),
    );
  });

  it("survives a JSON serialize/parse round-trip", () => {
    const keys = keyPair();
    const document = JSON.parse(
      JSON.stringify(signedDocument(keys.privateKeyPem)),
    ) as unknown;
    expect(() =>
      verifyPluginCatalog({
        document,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).not.toThrow();
  });
});

describe("verification fails closed", () => {
  it("rejects a tampered payload (digest catches it before re-signing)", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const tampered = clone(document);
    const component = tampered.catalog.plugins[0].versions[0].payload
      .components[0] as { endpointUrl?: string };
    component.endpointUrl = "https://evil.example.invalid/mcp";
    expect(() =>
      verifyPluginCatalog({
        document: tampered,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogDigestError);
  });

  it("rejects a tampered payload whose digests were recomputed but not re-signed", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const tampered = clone(document);
    tampered.catalog.plugins[0].description = "tampered description";
    // Keep the catalog-level digest consistent so the signature check is
    // what must catch the tamper.
    tampered.signature.catalogSha256 = pluginCatalogSha256(tampered.catalog);
    expect(() =>
      verifyPluginCatalog({
        document: tampered,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogSignatureError);
  });

  it("rejects tampered source provenance covered by the signature", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const tampered = clone(document);
    tampered.catalog.source = {
      repository: "thinkwork-ai/thinkwork",
      ref: "release",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
    };
    tampered.signature.catalogSha256 = pluginCatalogSha256(tampered.catalog);
    expect(() =>
      verifyPluginCatalog({
        document: tampered,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogSignatureError);
  });

  it("rejects verification with the wrong public key", () => {
    const signing = keyPair();
    const other = keyPair();
    const document = signedDocument(signing.privateKeyPem);
    expect(() =>
      verifyPluginCatalog({
        document,
        trustedPublicKeyPem: other.publicKeyPem,
      }),
    ).toThrow(PluginCatalogSignatureError);
  });

  it("rejects a per-version digest mismatch", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const tampered = clone(document);
    tampered.catalog.plugins[0].versions[0].payloadSha256 = "0".repeat(64);
    // Re-sign so the document-level signature is valid and the per-version
    // digest check is what must fail.
    const resigned = signPluginCatalog({
      catalog: tampered.catalog,
      privateKeyPem: keys.privateKeyPem,
    });
    expect(() =>
      verifyPluginCatalog({
        document: resigned,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogDigestError);
  });

  it("rejects an unknown schema version", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    const tampered = clone(document);
    (tampered.catalog as { schemaVersion: number }).schemaVersion = 99;
    expect(() =>
      verifyPluginCatalog({
        document: tampered,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogSchemaError);
  });

  it("rejects a non-object document", () => {
    const keys = keyPair();
    expect(() =>
      verifyPluginCatalog({
        document: null,
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogError);
  });

  it("rejects a document with a missing signature block", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    expect(() =>
      verifyPluginCatalog({
        document: { catalog: document.catalog },
        trustedPublicKeyPem: keys.publicKeyPem,
      }),
    ).toThrow(PluginCatalogSignatureError);
  });

  it("rejects a malformed trusted public key", () => {
    const keys = keyPair();
    const document = signedDocument(keys.privateKeyPem);
    expect(() =>
      verifyPluginCatalog({
        document,
        trustedPublicKeyPem: "not a pem",
      }),
    ).toThrow();
  });
});
