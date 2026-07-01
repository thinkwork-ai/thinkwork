import { mkdtempSync } from "node:fs";
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

const MANIFEST = {
  release: { version: "0.1.0-canary.200" },
  artifacts: [
    {
      name: "graphql-http",
      type: "lambda",
      fileName: "graphql-http.zip",
      url: "https://example.com/graphql-http.zip",
      sha256: "abc",
    },
    {
      name: "job-trigger",
      type: "lambda",
      fileName: "job-trigger.zip",
      url: "https://example.com/job-trigger.zip",
    },
    {
      name: "web",
      type: "static",
      fileName: "web.tar.gz",
      url: "https://example.com/web.tar.gz",
    },
  ],
  runtimeImages: [
    {
      name: "agentcore-pi",
      repository: "public.ecr.aws/thinkwork/agentcore-pi",
      tag: "0.1.0-canary.200",
      digest: "sha256:deadbeef",
      architecture: "arm64",
    },
    {
      name: "lambda-base",
      repository: "public.ecr.aws/thinkwork/lambda-base",
      tag: "x",
      digest: "sha256:other",
      architecture: "amd64",
    },
  ],
};

describe("parseReleaseArtifacts", () => {
  it("extracts lambda zips, the arm64 pi image (digest-pinned), and the web bundle", () => {
    const artifacts = parseReleaseArtifacts(MANIFEST);
    expect(artifacts.version).toBe("0.1.0-canary.200");
    expect(artifacts.lambdaZips.map((z) => z.name)).toEqual([
      "graphql-http",
      "job-trigger",
    ]);
    expect(artifacts.piImageUri).toBe(
      "public.ecr.aws/thinkwork/agentcore-pi@sha256:deadbeef",
    );
    expect(artifacts.webAssetUrl).toBe("https://example.com/web.tar.gz");
  });

  it("returns nulls for a manifest without images or web bundle", () => {
    const artifacts = parseReleaseArtifacts({
      release: { version: "0.0.1" },
      artifacts: [],
    });
    expect(artifacts.lambdaZips).toEqual([]);
    expect(artifacts.piImageUri).toBeNull();
    expect(artifacts.webAssetUrl).toBeNull();
  });
});

describe("seedLambdaArtifacts", () => {
  const ok: ExecResult = { status: 0, stdout: "", stderr: "" };
  const missing: ExecResult = { status: 254, stdout: "", stderr: "Not Found" };

  it("skips already-present objects and uploads the rest (idempotent)", async () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      if (args[1] === "head-object") {
        // First zip exists, second is missing.
        return args.join(" ").includes("graphql-http.zip") ? ok : missing;
      }
      return ok;
    };
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => {
      fetched.push(String(url));
      return new Response(Buffer.from("zipbytes"), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await seedLambdaArtifacts({
      zips: parseReleaseArtifacts(MANIFEST).lambdaZips,
      bucket: "thinkwork-tfstate-123",
      prefix: releaseLambdaPrefix("v0.1.0-canary.200"),
      exec,
      fetchImpl,
      tempDir: mkdtempSync(join(tmpdir(), "seed-test-")),
    });
    expect(result.skipped).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(fetched).toEqual(["https://example.com/job-trigger.zip"]);
    const cp = calls.find((c) => c[0] === "s3" && c[1] === "cp")!;
    expect(cp[3]).toBe(
      "s3://thinkwork-tfstate-123/release-artifacts/v0.1.0-canary.200/lambdas/job-trigger.zip",
    );
  });

  it("throws on a failed download", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(
      seedLambdaArtifacts({
        zips: [
          {
            name: "x",
            fileName: "x.zip",
            url: "https://example.com/x.zip",
          },
        ],
        bucket: "b",
        prefix: "p",
        exec: () => ({ status: 254, stdout: "", stderr: "" }),
        fetchImpl,
        tempDir: mkdtempSync(join(tmpdir(), "seed-test-")),
      }),
    ).rejects.toThrow(/404/);
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
    expect(out).toContain(
      'lambda_artifact_prefix = "release-artifacts/v1/lambdas"',
    );
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
