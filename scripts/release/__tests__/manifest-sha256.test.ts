import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  releaseManifestSha256,
  type ThinkWorkReleaseManifest,
} from "../../../packages/release-manifest/src/index";
import { computeReleaseManifestSha256 } from "../manifest-sha256.ts";

const execFileAsync = promisify(execFile);

function manifest(): ThinkWorkReleaseManifest {
  return {
    schemaVersion: 1,
    release: {
      version: "1.2.3",
      gitSha: "abc123",
      createdAt: "2026-06-06T00:00:00.000Z",
    },
    compatibility: {
      minCliVersion: "1.2.0",
      minRunnerVersion: "1.2.0",
      profileSchemaVersion: 1,
    },
    components: {
      cli: { version: "1.2.3" },
      terraform: {
        source: "thinkwork-ai/thinkwork/aws",
        version: "1.2.3",
      },
      deploymentRunner: {
        version: "1.2.3",
        image:
          "ghcr.io/thinkwork-ai/thinkwork-deployment-runner:v1.2.3@sha256:1111111111111111111111111111111111111111111111111111111111111111",
        script: {
          fileName: "thinkwork-runner.py",
          relativePath: "runner/thinkwork-runner.py",
          url: "https://example.test/thinkwork-runner.py",
          sha256:
            "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
          sizeBytes: 4,
        },
      },
      customerOverlay: { schemaVersion: 1 },
    },
    artifacts: [
      {
        name: "graphql-http",
        type: "lambda",
        fileName: "graphql-http.zip",
        relativePath: "lambdas/graphql-http.zip",
        url: "https://example.test/graphql-http.zip",
        sha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        sizeBytes: 5,
      },
    ],
    runtimeImages: [
      {
        name: "n8n-runtime",
        repository: "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore",
        tag: "v1.2.3-n8n-amd64",
        digest:
          "sha256:7777777777777777777777777777777777777777777777777777777777777777",
        architecture: "amd64",
        uri: "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v1.2.3-n8n-amd64@sha256:7777777777777777777777777777777777777777777777777777777777777777",
      },
    ],
    managedApps: [
      {
        id: "n8n",
        displayName: "n8n",
        terraformModule: {
          source: "thinkwork-ai/thinkwork/aws//modules/app/n8n",
          version: "1.2.3",
        },
        requiredImages: ["n8n-runtime"],
        smokeContracts: [
          {
            id: "n8n-health",
            command: "plugins/n8n/smoke/n8n-managed-app-smoke.mjs",
            required: true,
          },
        ],
      },
    ],
    signing: {
      acceptedKeyIds: [],
      revokedKeyIds: [],
    },
  };
}

test("manifest-sha256 emits the canonical manifest digest used by the API verifier", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "thinkwork-manifest-sha-"));
  const manifestPath = path.join(root, "thinkwork-release.json");
  const document = manifest();
  await writeFile(manifestPath, JSON.stringify(document, null, 2));

  const expected = releaseManifestSha256(document);
  const rawFileHash = createHash("sha256")
    .update(await readFile(manifestPath))
    .digest("hex");

  assert.notEqual(rawFileHash, expected);
  assert.equal(await computeReleaseManifestSha256(manifestPath), expected);

  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "tsx", "scripts/release/manifest-sha256.ts", manifestPath],
    { cwd: process.cwd() },
  );

  assert.equal(stdout.trim(), expected);
});
