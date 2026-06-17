/**
 * Catalog source tests (plan 2026-06-12-001 U5).
 *
 * Signed-mode behavior is exercised with a real ed25519 keypair: a
 * properly signed document verifies; a tampered payload, a wrong key, and
 * a missing document all fail closed. Unsigned mode (no SSM key) builds
 * the catalog in-process from the bundled manifests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  allPluginManifests,
  buildPluginCatalog,
  PluginCatalogError,
  signPluginCatalog,
  type SignedPluginCatalogDocument,
} from "@thinkwork/plugin-catalog";
import {
  compareSemverDesc,
  getPluginCatalog,
  getPluginCatalogSnapshot,
  getPluginVersion,
  PluginCatalogUnavailableError,
  resetPluginCatalogCacheForTests,
  trustedPublicKeyParameterName,
} from "./catalog-source.js";

function keyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function signedDocument(privateKeyPem: string): SignedPluginCatalogDocument {
  return signPluginCatalog({
    catalog: buildPluginCatalog({ manifests: allPluginManifests }),
    privateKeyPem,
  });
}

afterEach(() => {
  resetPluginCatalogCacheForTests();
});

describe("getPluginCatalog", () => {
  it("unsigned mode (no SSM key): builds the catalog in-process from bundled manifests", async () => {
    const catalog = await getPluginCatalog({
      readTrustedPublicKey: async () => null,
      loadSignedDocument: async () => {
        throw new Error("must not be called in unsigned mode");
      },
    });
    expect(catalog.plugins.map((p) => p.pluginKey)).toContain("lastmile");
  });

  it("signed mode: verifies a properly signed document", async () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const document = signedDocument(privateKeyPem);
    const catalog = await getPluginCatalog({
      readTrustedPublicKey: async () => publicKeyPem,
      loadSignedDocument: async () => document,
    });
    expect(catalog.plugins.map((p) => p.pluginKey)).toContain("lastmile");
  });

  it("signed mode with GitHub config: loads the verified release artifact", async () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const document = signPluginCatalog({
      catalog: buildPluginCatalog({
        manifests: allPluginManifests,
        generatedAt: "2026-06-17T00:00:00.000Z",
        source: {
          repository: "thinkwork-ai/thinkwork",
          ref: "main",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
        },
      }),
      privateKeyPem,
      signedAt: "2026-06-17T00:00:00.000Z",
    });
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/releases/tags/plugin-catalog-main")) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: "thinkwork-plugin-catalog-main.json",
                browser_download_url:
                  "https://example.invalid/thinkwork-plugin-catalog-main.json",
              },
            ],
          }),
          { headers: { etag: '"catalog"' } },
        );
      }
      return new Response(JSON.stringify(document));
    };

    const snapshot = await getPluginCatalogSnapshot({
      readTrustedPublicKey: async () => publicKeyPem,
      readGitHubConfig: () => ({
        repository: "thinkwork-ai/thinkwork",
        releaseTag: "plugin-catalog-main",
        assetName: "thinkwork-plugin-catalog-main.json",
        cacheTtlMs: 60_000,
        userAgent: "thinkwork-api-test",
      }),
      fetch: fetchImpl as typeof fetch,
      loadSignedDocument: async () => {
        throw new Error("bundled signed document should not be used");
      },
    });

    expect(snapshot.source).toBe("github-release");
    expect(snapshot.github?.sourceCommitSha).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(snapshot.catalog.plugins.map((p) => p.pluginKey)).toContain(
      "lastmile",
    );
  });

  it("signed GitHub mode: falls back to bundled signed catalog when remote verification fails without cache", async () => {
    const signer = keyPair();
    const trusted = keyPair();
    const badRemote = signedDocument(signer.privateKeyPem);
    const bundled = signedDocument(trusted.privateKeyPem);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/releases/tags/plugin-catalog-main")) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: "thinkwork-plugin-catalog-main.json",
                browser_download_url:
                  "https://example.invalid/thinkwork-plugin-catalog-main.json",
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify(badRemote));
    };

    const snapshot = await getPluginCatalogSnapshot({
      readTrustedPublicKey: async () => trusted.publicKeyPem,
      readGitHubConfig: () => ({
        repository: "thinkwork-ai/thinkwork",
        releaseTag: "plugin-catalog-main",
        assetName: "thinkwork-plugin-catalog-main.json",
        cacheTtlMs: 60_000,
        userAgent: "thinkwork-api-test",
      }),
      fetch: fetchImpl as typeof fetch,
      loadSignedDocument: async () => bundled,
    });

    expect(snapshot.source).toBe("bundled-signed");
    expect(snapshot.catalog.plugins.map((p) => p.pluginKey)).toContain(
      "lastmile",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("GitHub catalog unavailable"),
      expect.stringContaining("signature is invalid"),
    );
  });

  it("signed mode: fails closed on a tampered payload", async () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const document = signedDocument(privateKeyPem);
    const tampered = JSON.parse(
      JSON.stringify(document),
    ) as SignedPluginCatalogDocument;
    tampered.catalog.plugins[0]!.versions[0]!.payload.requiredOauthScopes.push(
      "admin:everything",
    );
    await expect(
      getPluginCatalog({
        readTrustedPublicKey: async () => publicKeyPem,
        loadSignedDocument: async () => tampered,
      }),
    ).rejects.toBeInstanceOf(PluginCatalogError);
  });

  it("signed mode: fails closed when signed with an untrusted key", async () => {
    const signer = keyPair();
    const trusted = keyPair();
    const document = signedDocument(signer.privateKeyPem);
    await expect(
      getPluginCatalog({
        readTrustedPublicKey: async () => trusted.publicKeyPem,
        loadSignedDocument: async () => document,
      }),
    ).rejects.toBeInstanceOf(PluginCatalogError);
  });

  it("signed mode: fails closed when the signed document is missing — never downgrades to unsigned", async () => {
    const { publicKeyPem } = keyPair();
    await expect(
      getPluginCatalog({
        readTrustedPublicKey: async () => publicKeyPem,
        loadSignedDocument: async () => null,
      }),
    ).rejects.toBeInstanceOf(PluginCatalogUnavailableError);
  });

  it("fails closed when the trust-anchor read itself errors", async () => {
    await expect(
      getPluginCatalog({
        readTrustedPublicKey: async () => {
          throw new PluginCatalogUnavailableError("ssm exploded");
        },
      }),
    ).rejects.toBeInstanceOf(PluginCatalogUnavailableError);
  });

  it("caches the verified catalog for the process lifetime", async () => {
    let reads = 0;
    const deps = {
      readTrustedPublicKey: async () => {
        reads += 1;
        return null;
      },
    };
    await getPluginCatalog(deps);
    await getPluginCatalog(deps);
    expect(reads).toBe(1);
  });
});

describe("getPluginVersion / semver helpers", () => {
  const unsigned = { readTrustedPublicKey: async () => null };

  it("resolves the latest version by default and a pinned version explicitly", async () => {
    const latest = await getPluginVersion("lastmile", null, unsigned);
    expect(latest).not.toBeNull();
    expect(latest!.versionEntry.payload.components.length).toBeGreaterThan(0);

    const pinned = await getPluginVersion(
      "lastmile",
      latest!.versionEntry.version,
      unsigned,
    );
    expect(pinned!.versionEntry.version).toBe(latest!.versionEntry.version);

    expect(await getPluginVersion("nope", null, unsigned)).toBeNull();
    expect(await getPluginVersion("lastmile", "99.0.0", unsigned)).toBeNull();
  });

  it("compareSemverDesc sorts newest first, prerelease below release", () => {
    expect(["0.9.0", "1.0.0", "0.10.0"].sort(compareSemverDesc)).toEqual([
      "1.0.0",
      "0.10.0",
      "0.9.0",
    ]);
    expect(["1.0.0-rc.1", "1.0.0"].sort(compareSemverDesc)).toEqual([
      "1.0.0",
      "1.0.0-rc.1",
    ]);
  });

  it("derives the SSM parameter name from the stage", () => {
    expect(trustedPublicKeyParameterName()).toMatch(
      /^\/thinkwork\/[^/]+\/plugin-catalog\/trusted-public-key$/,
    );
  });
});
