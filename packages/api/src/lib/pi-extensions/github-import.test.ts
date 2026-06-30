import { describe, expect, it, vi } from "vitest";
import {
  importPiExtensionFromGitHubSource,
  MAX_PI_EXTENSION_MANIFEST_BYTES,
  parseGitHubRepositoryUrl,
} from "./github-import.js";
import { normalizePiExtensionManifest } from "./manifest.js";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("parseGitHubRepositoryUrl", () => {
  it("normalizes https and ssh GitHub repository URLs", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/acme/pi-extension.git"),
    ).toEqual({
      owner: "acme",
      repo: "pi-extension",
      repositoryUrl: "https://github.com/acme/pi-extension",
    });
    expect(
      parseGitHubRepositoryUrl("git@github.com:acme/pi-extension.git"),
    ).toEqual({
      owner: "acme",
      repo: "pi-extension",
      repositoryUrl: "https://github.com/acme/pi-extension",
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() =>
      parseGitHubRepositoryUrl("https://example.com/acme/pi-extension"),
    ).toThrow("github.com");
  });
});

describe("normalizePiExtensionManifest", () => {
  it("normalizes v1 manifests with tools, hooks, and permissions", () => {
    expect(
      normalizePiExtensionManifest({
        schemaVersion: 1,
        name: "acme_extension",
        displayName: "ACME Extension",
        description: "Adds ACME tools.",
        runtimeTarget: "agentcore-pi",
        entrypoint: "dist/index.js",
        tools: [{ name: "acme_lookup" }],
        lifecycleHooks: ["session_start"],
        permissionClasses: ["network"],
      }),
    ).toMatchObject({
      name: "acme_extension",
      displayName: "ACME Extension",
      description: "Adds ACME tools.",
      runtimeTarget: "agentcore-pi",
      entrypoint: "dist/index.js",
      tools: [{ name: "acme_lookup" }],
      lifecycleHooks: ["session_start"],
      permissionClasses: ["network"],
    });
  });

  it("rejects duplicate tool names", () => {
    expect(() =>
      normalizePiExtensionManifest({
        name: "acme_extension",
        tools: ["acme_lookup", "acme_lookup"],
      }),
    ).toThrow("Duplicate extension tool name");
  });
});

describe("importPiExtensionFromGitHubSource", () => {
  it("resolves a GitHub ref and returns a needs-review candidate", async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ sha: COMMIT_SHA }),
      textResponse(
        JSON.stringify({
          schemaVersion: 1,
          name: "acme_extension",
          displayName: "ACME Extension",
          description: "Adds ACME tools.",
          runtimeTarget: "agentcore-pi",
          entrypoint: "dist/index.js",
          tools: [{ name: "acme_lookup" }],
          lifecycleHooks: ["session_start"],
          permissionClasses: ["network"],
        }),
      ),
    ]);

    const result = await importPiExtensionFromGitHubSource({
      request: {
        repositoryUrl: "https://github.com/acme/pi-extension",
        ref: "main",
      },
      fetchImpl,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(result.source).toEqual({
      sourceType: "github",
      repositoryUrl: "https://github.com/acme/pi-extension",
      owner: "acme",
      repo: "pi-extension",
    });
    expect(result.version).toMatchObject({
      sourceRef: "main",
      commitSha: COMMIT_SHA,
      displayName: "ACME Extension",
      description: "Adds ACME tools.",
      runtimeTarget: "agentcore-pi",
      toolNames: ["acme_lookup"],
      lifecycleHooks: ["session_start"],
      permissionClasses: ["network"],
      status: "needs_review",
      statusReason: null,
      artifactUri: `github://acme/pi-extension/${COMMIT_SHA}`,
    });
    expect(result.version.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.version.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.version.artifactDescriptor).toMatchObject({
      kind: "github-source-snapshot",
      commitSha: COMMIT_SHA,
      manifestPath: "pi-extension.json",
    });
    expect(result.version.verificationReport.status).toBe("passed");
  });

  it("sends GitHub API headers with an optional token", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghs_test";
    const fetchImpl = queuedFetch([
      jsonResponse({ sha: COMMIT_SHA }),
      textResponse(validManifest()),
    ]);

    try {
      await importPiExtensionFromGitHubSource({
        request: {
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
        fetchImpl,
        now: () => new Date("2026-06-30T00:00:00.000Z"),
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousToken;
      }
    }

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/repos/acme/pi-extension/commits/main`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer ghs_test",
          "User-Agent": "thinkwork-pi-extension-importer",
        },
      },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://raw.githubusercontent.com/acme/pi-extension/${COMMIT_SHA}/pi-extension.json`,
      {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Authorization: "Bearer ghs_test",
          "User-Agent": "thinkwork-pi-extension-importer",
        },
      },
    );
  });

  it("stores failed verification evidence when manifest verification fails", async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ sha: COMMIT_SHA }),
      textResponse(
        JSON.stringify({
          schemaVersion: 1,
          name: "acme_extension",
          runtimeTarget: "unknown-runtime",
          tools: [],
        }),
      ),
    ]);

    const result = await importPiExtensionFromGitHubSource({
      request: {
        repositoryUrl: "https://github.com/acme/pi-extension",
        ref: "main",
      },
      fetchImpl,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(result.version.status).toBe("failed_verification");
    expect(result.version.statusReason).toBe(
      "Unsupported runtime target: unknown-runtime",
    );
    expect(result.version.verificationReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported_runtime_target" }),
        expect.objectContaining({ code: "empty_extension_capabilities" }),
      ]),
    );
  });

  it("stores failed import evidence when the manifest cannot be fetched", async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ sha: COMMIT_SHA }),
      textResponse("not found", 404),
    ]);

    const result = await importPiExtensionFromGitHubSource({
      request: {
        repositoryUrl: "https://github.com/acme/pi-extension",
        ref: "main",
      },
      fetchImpl,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(result.version).toMatchObject({
      status: "failed_verification",
      statusReason: "Extension manifest could not be fetched (404)",
      commitSha: COMMIT_SHA,
      manifest: {},
      artifactHash: null,
    });
  });

  it("stores failed import evidence when the manifest is too large", async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ sha: COMMIT_SHA }),
      textResponse("{}", 200, {
        "content-length": String(MAX_PI_EXTENSION_MANIFEST_BYTES + 1),
      }),
    ]);

    const result = await importPiExtensionFromGitHubSource({
      request: {
        repositoryUrl: "https://github.com/acme/pi-extension",
        ref: "main",
      },
      fetchImpl,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(result.version).toMatchObject({
      status: "failed_verification",
      statusReason: `Extension manifest exceeds ${MAX_PI_EXTENSION_MANIFEST_BYTES} byte limit`,
      commitSha: COMMIT_SHA,
    });
  });

  it("does not convert unexpected fetch errors into failed verification rows", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network unavailable");
    }) as unknown as typeof fetch;

    await expect(
      importPiExtensionFromGitHubSource({
        request: {
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
        fetchImpl,
        now: () => new Date("2026-06-30T00:00:00.000Z"),
      }),
    ).rejects.toThrow("network unavailable");
  });
});

function queuedFetch(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  }) as unknown as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function textResponse(
  value: string,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(value, { status, headers });
}

function validManifest(): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "acme_extension",
    displayName: "ACME Extension",
    runtimeTarget: "agentcore-pi",
    entrypoint: "dist/index.js",
    tools: [{ name: "acme_lookup" }],
  });
}
