import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("write-deployment-status emits the canonical current pointer contract", async () => {
  const { stdout } = await execFileAsync(
    "bash",
    [
      path.join(process.cwd(), "scripts/release/write-deployment-status.sh"),
      "--dry-run",
      "--stage",
      "dev",
      "--bucket",
      "thinkwork-dev-123456789012-deploy-evidence",
      "--release-version",
      "v0.1.0-canary.165",
      "--manifest-url",
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.165/thinkwork-release.json",
      "--manifest-sha256",
      "a".repeat(64),
      "--commit",
      "b".repeat(40),
      "--state-machine-arn",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
      "--runner-project-name",
      "thinkwork-dev-deployment-runner",
      "--github-repository",
      "thinkwork-ai/thinkwork",
      "--github-run-id",
      "12345",
      "--github-run-attempt",
      "1",
      "--github-run-at",
      "2026-06-11T10:30:00Z",
      "--github-ref",
      "refs/tags/v0.1.0-canary.165",
      "--github-workflow",
      "Release",
      "--github-actor",
      "github-actions[bot]",
    ],
    { cwd: process.cwd() },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.stage, "dev");
  assert.equal(status.status, "succeeded");
  assert.equal(status.source, "github-actions");
  assert.equal(status.updatedAt, "2026-06-11T10:30:00Z");
  assert.deepEqual(status.activeRelease, {
    version: "v0.1.0-canary.165",
    manifestUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.165/thinkwork-release.json",
    manifestSha256: "a".repeat(64),
    commitSha: "b".repeat(40),
  });
  assert.deepEqual(status.controller, {
    evidenceBucketName: "thinkwork-dev-123456789012-deploy-evidence",
    stateMachineArn:
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
    codebuildProjectName: "thinkwork-dev-deployment-runner",
  });
  assert.deepEqual(status.github, {
    repository: "thinkwork-ai/thinkwork",
    runId: "12345",
    runAttempt: "1",
    ref: "refs/tags/v0.1.0-canary.165",
    workflow: "Release",
    actor: "github-actions[bot]",
  });
});

test("write-deployment-status preserves complete active release when source deploy lacks manifest metadata", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "thinkwork-status-"));
  const previousStatus = path.join(dir, "current.json");
  await writeFile(
    previousStatus,
    JSON.stringify({
      activeRelease: {
        version: "v0.1.0-canary.229",
        manifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.229/thinkwork-release.json",
        manifestSha256: "c".repeat(64),
        commitSha: "d".repeat(40),
      },
    }),
  );

  try {
    const { stdout } = await execFileAsync(
      "bash",
      [
        path.join(process.cwd(), "scripts/release/write-deployment-status.sh"),
        "--dry-run",
        "--stage",
        "dev",
        "--bucket",
        "thinkwork-dev-123456789012-deploy-evidence",
        "--release-version",
        "v0.1.0-canary.229+1",
        "--commit",
        "e".repeat(40),
        "--previous-status-file",
        previousStatus,
        "--state-machine-arn",
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
        "--runner-project-name",
        "thinkwork-dev-deployment-runner",
        "--github-run-id",
        "67890",
      ],
      { cwd: process.cwd() },
    );

    const status = JSON.parse(stdout);
    assert.deepEqual(status.activeRelease, {
      version: "v0.1.0-canary.229",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.229/thinkwork-release.json",
      manifestSha256: "c".repeat(64),
      commitSha: "d".repeat(40),
    });
    assert.equal(status.github.runId, "67890");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
