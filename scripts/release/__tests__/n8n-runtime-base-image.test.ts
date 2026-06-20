import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const MINIMUM_MCP_CAPABLE_N8N_VERSION = "2.18.5";

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, `expected semantic n8n version, got ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

function parsePinnedN8nImage(value: string): {
  version: string;
  digest: string;
} {
  const match = value.match(
    /^n8nio\/n8n:(\d+\.\d+\.\d+)@(sha256:[a-f0-9]{64})$/,
  );
  assert.ok(
    match,
    `n8n runtime base image must be pinned as n8nio/n8n:<version>@sha256:<digest>; got ${value}`,
  );
  return { version: match[1], digest: match[2] };
}

test("n8n runtime base image is MCP-capable and release workflow matches it", async () => {
  const root = process.cwd();
  const dockerfilePath = path.join(root, "plugins/n8n/runtime/Dockerfile");
  const releaseWorkflowPath = path.join(root, ".github/workflows/release.yml");

  const dockerfile = await readFile(dockerfilePath, "utf8");
  const releaseWorkflow = await readFile(releaseWorkflowPath, "utf8");

  const dockerfileBaseImage = dockerfile.match(
    /^ARG N8N_BASE_IMAGE=(.+)$/m,
  )?.[1];
  const workflowBaseImage = releaseWorkflow.match(
    /^\s+N8N_BASE_IMAGE=(.+)$/m,
  )?.[1];

  assert.ok(dockerfileBaseImage, "Dockerfile must define N8N_BASE_IMAGE");
  assert.ok(workflowBaseImage, "release workflow must pass N8N_BASE_IMAGE");
  assert.equal(
    workflowBaseImage,
    dockerfileBaseImage,
    "release workflow and Dockerfile must use the same n8n base image",
  );

  const { version } = parsePinnedN8nImage(dockerfileBaseImage);
  assert.ok(
    compareVersion(version, MINIMUM_MCP_CAPABLE_N8N_VERSION) >= 0,
    `n8n ${version} is below the MCP-capable floor ${MINIMUM_MCP_CAPABLE_N8N_VERSION}`,
  );
});
