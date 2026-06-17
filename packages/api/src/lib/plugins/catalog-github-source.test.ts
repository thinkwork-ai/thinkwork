import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allPluginManifests,
  buildPluginCatalog,
  signPluginCatalog,
  type SignedPluginCatalogDocument,
} from "@thinkwork/plugin-catalog";
import {
  createS3GitHubPluginCatalogCache,
  GitHubPluginCatalogSourceError,
  loadGitHubPluginCatalog,
  pluginCatalogGitHubConfigFromEnv,
  pluginCatalogGitHubConfigFromRuntime,
  resetGitHubPluginCatalogCacheForTests,
  type GitHubPluginCatalogConfig,
} from "./catalog-github-source.js";

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

function signedDocument(options: {
  privateKeyPem: string;
  commitSha?: string;
}): SignedPluginCatalogDocument {
  return signPluginCatalog({
    catalog: buildPluginCatalog({
      manifests: allPluginManifests,
      generatedAt: "2026-06-17T00:00:00.000Z",
      source: {
        repository: "thinkwork-ai/thinkwork",
        ref: "main",
        commitSha:
          options.commitSha ?? "0123456789abcdef0123456789abcdef01234567",
      },
    }),
    privateKeyPem: options.privateKeyPem,
    signedAt: "2026-06-17T00:00:00.000Z",
  });
}

function config(overrides: Partial<GitHubPluginCatalogConfig> = {}) {
  return {
    repository: "thinkwork-ai/thinkwork",
    releaseTag: "plugin-catalog-main",
    assetName: "thinkwork-plugin-catalog-main.json",
    cacheTtlMs: 1,
    userAgent: "thinkwork-api-test",
    ...overrides,
  } satisfies GitHubPluginCatalogConfig;
}

function releaseResponse(status = 200): Response {
  return new Response(
    JSON.stringify({
      assets: [
        {
          name: "thinkwork-plugin-catalog-main.json",
          browser_download_url:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/plugin-catalog-main/thinkwork-plugin-catalog-main.json",
        },
      ],
    }),
    {
      status,
      headers: {
        etag: '"release-etag"',
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1760000000",
      },
    },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function queuedFetch(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  resetGitHubPluginCatalogCacheForTests();
  delete process.env.THINKWORK_PLUGIN_CATALOG_SOURCE;
  delete process.env.THINKWORK_PLUGIN_CATALOG_REPOSITORY;
  delete process.env.THINKWORK_PLUGIN_CATALOG_RELEASE_TAG;
  delete process.env.THINKWORK_PLUGIN_CATALOG_ASSET_NAME;
  delete process.env.THINKWORK_PLUGIN_CATALOG_CACHE_TTL_SECONDS;
  delete process.env.THINKWORK_PLUGIN_CATALOG_USER_AGENT;
  vi.restoreAllMocks();
});

describe("pluginCatalogGitHubConfigFromEnv", () => {
  it("stays disabled unless GitHub mode is configured", () => {
    expect(pluginCatalogGitHubConfigFromEnv({})).toBeNull();
    expect(
      pluginCatalogGitHubConfigFromEnv({
        THINKWORK_PLUGIN_CATALOG_SOURCE: "github",
      })?.releaseTag,
    ).toBe("plugin-catalog-main");
  });

  it("reads runtime-config-backed values through the env-wins runtime loader", async () => {
    process.env.THINKWORK_PLUGIN_CATALOG_SOURCE = "github";
    process.env.THINKWORK_PLUGIN_CATALOG_REPOSITORY =
      "thinkwork-ai/thinkwork-test";
    process.env.THINKWORK_PLUGIN_CATALOG_RELEASE_TAG = "plugin-catalog-test";
    process.env.THINKWORK_PLUGIN_CATALOG_ASSET_NAME = "catalog-test.json";
    process.env.THINKWORK_PLUGIN_CATALOG_CACHE_TTL_SECONDS = "42";
    process.env.THINKWORK_PLUGIN_CATALOG_USER_AGENT = "thinkwork-test";

    await expect(pluginCatalogGitHubConfigFromRuntime()).resolves.toMatchObject(
      {
        repository: "thinkwork-ai/thinkwork-test",
        releaseTag: "plugin-catalog-test",
        assetName: "catalog-test.json",
        cacheTtlMs: 42_000,
        userAgent: "thinkwork-test",
      },
    );
  });
});

describe("loadGitHubPluginCatalog", () => {
  it("fetches, verifies, caches, and returns a signed catalog artifact", async () => {
    const keys = keyPair();
    const document = signedDocument({ privateKeyPem: keys.privateKeyPem });
    const fetchImpl = queuedFetch([releaseResponse(), jsonResponse(document)]);

    const snapshot = await loadGitHubPluginCatalog({
      config: config({ cacheTtlMs: 60_000 }),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:00.000Z"),
    });

    expect(
      snapshot.catalog.plugins.map((plugin) => plugin.pluginKey),
    ).toContain("lastmile");
    expect(snapshot.status).toMatchObject({
      source: "github-release",
      repository: "thinkwork-ai/thinkwork",
      releaseTag: "plugin-catalog-main",
      assetName: "thinkwork-plugin-catalog-main.json",
      sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
      stale: false,
      lastRefreshStatus: "fresh",
      rateLimitRemaining: "4999",
    });

    const cached = await loadGitHubPluginCatalog({
      config: config({ cacheTtlMs: 60_000 }),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:01.000Z"),
    });
    expect(cached.status.sourceCommitSha).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it("serves the verified cache on GitHub 304", async () => {
    const keys = keyPair();
    const document = signedDocument({ privateKeyPem: keys.privateKeyPem });
    const fetchImpl = queuedFetch([
      releaseResponse(),
      jsonResponse(document),
      new Response(null, { status: 304 }),
    ]);

    await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:00.000Z"),
    });
    const snapshot = await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:01.000Z"),
    });

    expect(snapshot.status).toMatchObject({
      stale: false,
      lastRefreshStatus: "not-modified",
    });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(3);
  });

  it("serves stale verified cache on transient GitHub failures", async () => {
    const keys = keyPair();
    const document = signedDocument({ privateKeyPem: keys.privateKeyPem });
    const fetchImpl = queuedFetch([
      releaseResponse(),
      jsonResponse(document),
      new Response("rate limited", { status: 403 }),
    ]);

    await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:00.000Z"),
    });
    const snapshot = await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:01.000Z"),
    });

    expect(snapshot.status.stale).toBe(true);
    expect(snapshot.status.lastRefreshStatus).toBe("stale-fallback");
    expect(snapshot.status.message).toMatch(/403/);
  });

  it("rejects a bad signature when no verified cache exists", async () => {
    const signer = keyPair();
    const trusted = keyPair();
    const document = signedDocument({ privateKeyPem: signer.privateKeyPem });
    const fetchImpl = queuedFetch([releaseResponse(), jsonResponse(document)]);

    await expect(
      loadGitHubPluginCatalog({
        config: config(),
        trustedPublicKeyPem: trusted.publicKeyPem,
        fetchImpl,
      }),
    ).rejects.toThrow(/signature is invalid/);
  });

  it("does not overwrite the last good cache with malformed remote data", async () => {
    const keys = keyPair();
    const good = signedDocument({
      privateKeyPem: keys.privateKeyPem,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
    });
    const malformed = { nope: true };
    const fetchImpl = queuedFetch([
      releaseResponse(),
      jsonResponse(good),
      releaseResponse(),
      jsonResponse(malformed),
    ]);

    await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:00.000Z"),
    });
    const snapshot = await loadGitHubPluginCatalog({
      config: config(),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      now: () => new Date("2026-06-17T01:00:01.000Z"),
    });

    expect(snapshot.status.stale).toBe(true);
    expect(snapshot.status.sourceCommitSha).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("fails without cache when the release asset is missing", async () => {
    const keys = keyPair();
    const fetchImpl = queuedFetch([
      jsonResponse({ assets: [{ name: "other.json" }] }),
    ]);

    await expect(
      loadGitHubPluginCatalog({
        config: config(),
        trustedPublicKeyPem: keys.publicKeyPem,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GitHubPluginCatalogSourceError);
  });

  it("persists a verified signed catalog in S3 and re-verifies it on read", async () => {
    const keys = keyPair();
    const document = signedDocument({ privateKeyPem: keys.privateKeyPem });
    let objectBody = "";
    const client = {
      send: vi.fn(
        async (command: { constructor: { name: string }; input: any }) => {
          if (command.constructor.name === "PutObjectCommand") {
            objectBody = command.input.Body;
            return {};
          }
          if (command.constructor.name === "GetObjectCommand") {
            if (!objectBody) {
              const error = new Error("not found");
              error.name = "NoSuchKey";
              throw error;
            }
            return { Body: objectBody };
          }
          throw new Error(`unexpected command ${command.constructor.name}`);
        },
      ),
    };
    const cache = createS3GitHubPluginCatalogCache({
      bucket: "cache-bucket",
      key: "system/plugin-catalog/cache.json",
      trustedPublicKeyPem: keys.publicKeyPem,
      client,
    });
    const fetchImpl = queuedFetch([releaseResponse(), jsonResponse(document)]);

    const fresh = await loadGitHubPluginCatalog({
      config: config({ cacheTtlMs: 1 }),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      cache,
      now: () => new Date("2026-06-17T01:00:00.000Z"),
    });
    expect(fresh.status.lastRefreshStatus).toBe("fresh");

    const cached = await loadGitHubPluginCatalog({
      config: config({ cacheTtlMs: 60_000 }),
      trustedPublicKeyPem: keys.publicKeyPem,
      fetchImpl,
      cache,
      now: () => new Date("2026-06-17T01:00:01.000Z"),
    });

    expect(cached.status.sourceCommitSha).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });
});
