import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseManifest,
  parseArtifactSpec,
  parseRuntimeImageSpec,
} from "../build-release-manifest.ts";

async function makeTempReleaseRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "thinkwork-release-"));
}

test("buildReleaseManifest emits stable artifact metadata", async () => {
  const root = await makeTempReleaseRoot();
  const lambdaDir = path.join(root, "lambdas");
  const staticDir = path.join(root, "static");
  await mkdir(lambdaDir, { recursive: true });
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(lambdaDir, "graphql-http.zip"), "lambda-bytes");
  await writeFile(path.join(staticDir, "admin.tar.gz"), "admin-bytes");

  const manifest = await buildReleaseManifest({
    version: "v1.2.3",
    gitSha: "abc123",
    artifactRoot: root,
    lambdaDir,
    baseUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/",
    createdAt: "2026-05-18T00:00:00.000Z",
    artifacts: [
      {
        name: "admin",
        type: "static-site",
        path: path.join(staticDir, "admin.tar.gz"),
      },
    ],
    runtimeImages: [
      {
        name: "agentcore-strands-arm64",
        repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
        tag: "v1.2.3-arm64",
        digest:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        architecture: "arm64",
      },
      {
        name: "agentcore-strands-amd64",
        repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
        tag: "v1.2.3-amd64",
        digest:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        architecture: "amd64",
      },
    ],
  });

  assert.equal(manifest.release.version, "1.2.3");
  assert.deepEqual(
    manifest.artifacts.map(
      (artifact) => `${artifact.type}:${artifact.name}:${artifact.fileName}`,
    ),
    ["lambda:graphql-http:graphql-http.zip", "static-site:admin:admin.tar.gz"],
  );
  assert.equal(
    manifest.artifacts[0]?.url,
    "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/graphql-http.zip",
  );
  assert.equal(manifest.artifacts[0]?.sha256.length, 64);
  assert.deepEqual(
    manifest.runtimeImages.map((image) => image.name),
    ["agentcore-strands-amd64", "agentcore-strands-arm64"],
  );
  assert.equal(
    manifest.runtimeImages[0]?.uri,
    "ghcr.io/thinkwork-ai/thinkwork-agentcore:v1.2.3-amd64@sha256:2222222222222222222222222222222222222222222222222222222222222222",
  );
});

test("buildReleaseManifest fails when a required artifact is missing", async () => {
  const root = await makeTempReleaseRoot();

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          {
            name: "admin",
            type: "static-site",
            path: path.join(root, "static", "admin.tar.gz"),
          },
        ],
      }),
    /Required release artifact "admin" is missing/,
  );
});

test("buildReleaseManifest rejects duplicate logical artifact names", async () => {
  const root = await makeTempReleaseRoot();
  const artifactPath = path.join(root, "one.zip");
  await writeFile(artifactPath, "bytes");

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          { name: "graphql-http", type: "lambda", path: artifactPath },
          { name: "graphql-http", type: "static-site", path: artifactPath },
        ],
      }),
    /Duplicate release artifact logical name: graphql-http/,
  );
});

test("spec parsers reject incomplete artifact and image definitions", () => {
  assert.deepEqual(
    parseArtifactSpec(
      "name=admin,type=static-site,path=dist/release/admin.tar.gz",
    ),
    {
      name: "admin",
      type: "static-site",
      path: "dist/release/admin.tar.gz",
      required: true,
    },
  );

  assert.throws(
    () => parseArtifactSpec("name=admin,path=dist/release/admin.tar.gz"),
    /Invalid/,
  );
  assert.throws(
    () =>
      parseRuntimeImageSpec(
        "name=strands,repository=ghcr.io/thinkwork-ai/thinkwork-agentcore,tag=v1",
      ),
    /architecture/,
  );
});
