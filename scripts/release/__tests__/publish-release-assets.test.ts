import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "thinkwork-publish-release-"));
}

test("publish-release-assets removes stale manifests and uploads the finalized manifest last", async () => {
  const root = await makeTempRoot();
  const releaseDir = path.join(root, "release");
  const binDir = path.join(root, "bin");
  const logPath = path.join(root, "gh.log");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(releaseDir, "thinkwork-release.json"), "{}");
  await writeFile(path.join(releaseDir, "thinkwork-release.sig.json"), "{}");
  await writeFile(path.join(releaseDir, "platform-artifacts.tar.gz"), "bundle");

  const fakeGh = path.join(binDir, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
exit 0
`,
  );
  await chmod(fakeGh, 0o755);

  await execFileAsync(
    "bash",
    [
      path.join(process.cwd(), "scripts/release/publish-release-assets.sh"),
      "v0.1.0-canary.150",
      releaseDir,
    ],
    {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    },
  );

  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.deepEqual(lines.slice(0, 3), [
    "release delete-asset v0.1.0-canary.150 thinkwork-release.json --yes",
    "release delete-asset v0.1.0-canary.150 thinkwork-release.sig.json --yes",
    "release delete-asset v0.1.0-canary.150 thinkwork-release.json.sig --yes",
  ]);

  assert.equal(lines.length, 5);
  assert.match(
    lines[3] ?? "",
    /^release upload v0\.1\.0-canary\.150 .+thinkwork-release\.sig\.json .+platform-artifacts\.tar\.gz --clobber$/,
  );
  assert.match(
    lines[4] ?? "",
    /^release upload v0\.1\.0-canary\.150 .+thinkwork-release\.json --clobber$/,
  );
});
