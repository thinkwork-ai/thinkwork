import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseReleaseArtifacts,
  releaseLambdaPrefix,
  seedLambdaArtifacts,
  upsertTfvarsValues,
} from "../src/lib/release.js";
import type { ExecResult } from "../src/lib/state-backend.js";

// Mirrors the real v0.1.0-canary.* manifest shape: zips live inside one
// platform bundle (per-artifact url: null, relativePath set) — harness
// cycle-2 ledger entry.
const BUNDLED_MANIFEST = {
  release: { version: "0.1.0-canary.307" },
  artifacts: [
    {
      name: "graphql-http",
      type: "lambda",
      fileName: "graphql-http.zip",
      relativePath: "lambdas/graphql-http.zip",
      url: null,
      sha256: "abc",
    },
    {
      name: "job-trigger",
      type: "lambda",
      fileName: "job-trigger.zip",
      relativePath: "lambdas/job-trigger.zip",
      url: null,
    },
    {
      name: "web",
      type: "static-site",
      fileName: "web.tar.gz",
      relativePath: "static/web.tar.gz",
      url: null,
    },
  ],
  artifactBundles: [
    {
      name: "platform",
      fileName: "platform-artifacts.tar.gz",
      url: "https://example.com/platform-artifacts.tar.gz",
    },
  ],
  runtimeImages: [
    {
      name: "agentcore-pi-arm64",
      repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
      tag: "0.1.0-canary.307",
      digest: "sha256:deadbeef",
      architecture: "arm64",
    },
    {
      name: "agentcore-pi-amd64",
      repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
      tag: "0.1.0-canary.307",
      digest: "sha256:other",
      architecture: "amd64",
    },
  ],
};

const ok: ExecResult = { status: 0, stdout: "", stderr: "" };
const missing: ExecResult = { status: 254, stdout: "", stderr: "Not Found" };

describe("parseReleaseArtifacts", () => {
  it("parses the real bundled-manifest shape: relative paths, bundle, arm64 pi image", () => {
    const artifacts = parseReleaseArtifacts(BUNDLED_MANIFEST);
    expect(artifacts.version).toBe("0.1.0-canary.307");
    expect(artifacts.lambdaZips.map((z) => z.name)).toEqual([
      "graphql-http",
      "job-trigger",
    ]);
    expect(artifacts.lambdaZips[0].relativePath).toBe(
      "lambdas/graphql-http.zip",
    );
    expect(artifacts.lambdaZips[0].url).toBeNull();
    expect(artifacts.piImageUri).toBe(
      "ghcr.io/thinkwork-ai/thinkwork-agentcore@sha256:deadbeef",
    );
    expect(artifacts.webAsset).toEqual({
      url: null,
      relativePath: "static/web.tar.gz",
    });
    expect(artifacts.bundle).toEqual({
      fileName: "platform-artifacts.tar.gz",
      url: "https://example.com/platform-artifacts.tar.gz",
    });
  });

  it("still accepts unbundled manifests with per-artifact URLs", () => {
    const artifacts = parseReleaseArtifacts({
      release: { version: "0.0.1" },
      artifacts: [
        {
          name: "graphql-http",
          type: "lambda",
          fileName: "graphql-http.zip",
          url: "https://example.com/graphql-http.zip",
        },
      ],
    });
    expect(artifacts.lambdaZips).toHaveLength(1);
    expect(artifacts.lambdaZips[0].url).toBe(
      "https://example.com/graphql-http.zip",
    );
    expect(artifacts.bundle).toBeNull();
  });

  it("returns empty/null for a manifest without artifacts", () => {
    const artifacts = parseReleaseArtifacts({ release: { version: "0.0.1" } });
    expect(artifacts.lambdaZips).toEqual([]);
    expect(artifacts.piImageUri).toBeNull();
    expect(artifacts.webAsset).toBeNull();
  });
});

describe("seedLambdaArtifacts", () => {
  it("seeds bundle-relative zips from the extraction root without fetching", async () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), "bundle-root-"));
    mkdirSync(join(bundleRoot, "lambdas"), { recursive: true });
    writeFileSync(join(bundleRoot, "lambdas", "graphql-http.zip"), "zip1");
    writeFileSync(join(bundleRoot, "lambdas", "job-trigger.zip"), "zip2");

    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      return args[1] === "head-object" ? missing : ok;
    };
    const fetchImpl = (async () => {
      throw new Error("must not fetch when the bundle provides the file");
    }) as unknown as typeof fetch;

    const result = await seedLambdaArtifacts({
      zips: parseReleaseArtifacts(BUNDLED_MANIFEST).lambdaZips,
      bucket: "thinkwork-tfstate-123",
      prefix: releaseLambdaPrefix("v0.1.0-canary.307"),
      bundleRoot,
      exec,
      fetchImpl,
    });
    expect(result.uploaded).toBe(2);
    const cp = calls.find((c) => c[0] === "s3" && c[1] === "cp")!;
    expect(cp[2]).toContain("lambdas/graphql-http.zip");
  });

  it("skips already-present objects (idempotent reruns)", async () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), "bundle-root-"));
    const exec = (): ExecResult => ok; // head-object succeeds for everything
    const result = await seedLambdaArtifacts({
      zips: parseReleaseArtifacts(BUNDLED_MANIFEST).lambdaZips,
      bucket: "b",
      prefix: "p",
      bundleRoot,
      exec,
    });
    expect(result.skipped).toBe(2);
    expect(result.uploaded).toBe(0);
  });

  it("downloads per-URL zips when no bundle path exists", async () => {
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => {
      fetched.push(String(url));
      return new Response(Buffer.from("zipbytes"), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await seedLambdaArtifacts({
      zips: [
        {
          name: "x",
          fileName: "x.zip",
          url: "https://example.com/x.zip",
          relativePath: null,
        },
      ],
      bucket: "b",
      prefix: "p",
      exec: (args) => (args[1] === "head-object" ? missing : ok),
      fetchImpl,
      tempDir: mkdtempSync(join(tmpdir(), "seed-test-")),
    });
    expect(result.uploaded).toBe(1);
    expect(fetched).toEqual(["https://example.com/x.zip"]);
  });

  it("throws a named error when an artifact has neither URL nor bundle path", async () => {
    await expect(
      seedLambdaArtifacts({
        zips: [{ name: "x", fileName: "x.zip", url: null, relativePath: null }],
        bucket: "b",
        prefix: "p",
        exec: () => missing,
      }),
    ).rejects.toThrow(/neither a download URL nor a bundle path/);
  });
});

describe("upsertTfvarsValues", () => {
  const BASE = [
    "# Thinkwork — prod stage",
    'stage      = "prod"',
    'db_password     = "secret"',
    "",
  ].join("\n");

  it("appends new keys under a release-artifacts header, preserving the rest", () => {
    const out = upsertTfvarsValues(BASE, {
      lambda_artifact_bucket: "thinkwork-tfstate-123",
      lambda_artifact_prefix: "release-artifacts/v1/lambdas",
    });
    expect(out).toContain('stage      = "prod"');
    expect(out).toContain('db_password     = "secret"');
    expect(out).toContain("Release artifacts");
    expect(out).toContain('lambda_artifact_bucket = "thinkwork-tfstate-123"');
  });

  it("updates existing keys in place without duplicating them", () => {
    const withPin = upsertTfvarsValues(BASE, {
      lambda_artifact_prefix: "release-artifacts/v1/lambdas",
    });
    const repinned = upsertTfvarsValues(withPin, {
      lambda_artifact_prefix: "release-artifacts/v2/lambdas",
    });
    const occurrences = repinned
      .split("\n")
      .filter((l) => l.includes("lambda_artifact_prefix"));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toContain("release-artifacts/v2/lambdas");
  });
});
