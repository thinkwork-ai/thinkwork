import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_BUILDER_HISTORY_FOR_TESTING,
  type ArtifactBuilderManagedPath,
} from "./artifact-builder-defaults.js";

// Parity test: every historical version of each managed artifact-builder file
// that ever existed on `main` must be registered in the upgradable-SHA set.
// Without this, agents materialized off an unregistered platform default get
// stranded on stale content forever (the orphan SHA `4281155...` from commit
// 6b31f0f4 hit Eric's dev agent on 2026-05-22 — this test prevents recurrence).
//
// The test reads from the repo's `.git`, which is available in CI and locally
// when full history is fetched. Shallow clones (default for many CI checkouts)
// cannot enumerate file history; the `beforeAll` guard throws a clear setup
// error so the failure points operators at the fix (add `fetch-depth: 0` to
// the workflow's actions/checkout step). The CI test workflow has been updated
// to fetch full history.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ensureGitAvailable(): void {
  try {
    git(["rev-parse", "--git-dir"]);
  } catch (err) {
    throw new Error(
      "This test requires `git` on PATH and a real .git directory. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function isShallowClone(): boolean {
  const out = git(["rev-parse", "--is-shallow-repository"]).trim();
  return out === "true";
}

function commitsTouching(path: string): string[] {
  const out = git(["log", "--pretty=format:%H", "--", path]);
  return out.split("\n").filter((line) => line.length === 40);
}

function shaAtCommit(commit: string, path: string): string | null {
  try {
    const content = execFileSync("git", ["show", `${commit}:${path}`], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return createHash("sha256").update(content).digest("hex");
  } catch {
    // Path didn't exist at this commit (e.g. ancestor before the file was added).
    return null;
  }
}

function shaAtHead(path: string): string {
  const content = execFileSync("git", ["show", `HEAD:${path}`], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return createHash("sha256").update(content).digest("hex");
}

describe("artifact-builder upgradable-SHA history parity", () => {
  beforeAll(() => {
    ensureGitAvailable();
    if (isShallowClone()) {
      throw new Error(
        "This test requires full git history. CI runs need actions/checkout@v4 with fetch-depth: 0. " +
          "Locally run `git fetch --unshallow` (or check out the repo with full history) and retry.",
      );
    }
  });

  for (const path of Object.keys(
    ARTIFACT_BUILDER_HISTORY_FOR_TESTING,
  ) as ArtifactBuilderManagedPath[]) {
    describe(path, () => {
      const registered = ARTIFACT_BUILDER_HISTORY_FOR_TESTING[path];
      const commits = commitsTouching(path);
      const headSha = shaAtHead(path);
      const historicalShas = new Set<string>();
      for (const commit of commits) {
        const sha = shaAtCommit(commit, path);
        if (!sha || sha === headSha) continue;
        historicalShas.add(sha);
      }

      it("has at least one historical commit", () => {
        expect(commits.length).toBeGreaterThan(0);
      });

      it("excludes the HEAD-commit SHA from the upgradable set", () => {
        // Including HEAD would mean ensureArtifactBuilderDefaults would PUT the
        // same content the file already has — a wasted S3 write on every
        // dispatch. The upgradable set means "if S3 looks like THIS, overwrite";
        // matching HEAD makes that a no-op.
        expect(
          registered.has(headSha),
          `${path}: current HEAD content SHA (${headSha}) must NOT be in the upgradable set`,
        ).toBe(false);
      });

      it("registers every prior historical content SHA", () => {
        const missing: Array<{ sha: string; commit: string; subject: string }> =
          [];
        const seen = new Set<string>();
        for (const commit of commits) {
          const sha = shaAtCommit(commit, path);
          if (!sha || sha === headSha) continue;
          if (seen.has(sha)) continue;
          seen.add(sha);
          if (!registered.has(sha)) {
            const subject = git([
              "log",
              "-1",
              "--pretty=format:%s",
              commit,
            ]).trim();
            const short = commit.slice(0, 8);
            missing.push({ sha, commit: short, subject });
          }
        }
        if (missing.length > 0) {
          const lines = missing.map(
            (m) => `  "${m.sha}", // ${m.commit} ${m.subject}`,
          );
          throw new Error(
            `Drift detected: ${missing.length} historical SHA(s) for ${path} ` +
              `are missing from UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH. ` +
              `Add the following entries:\n${lines.join("\n")}`,
          );
        }
      });

      it("contains no cruft SHAs that do not appear in git history", () => {
        // Inverse drift check: every SHA in the registry must correspond to
        // some commit. Typos, stale entries from reverted PRs, or copy-paste
        // mistakes show up here. Without this assertion, the registry can
        // accumulate noise that gives a false sense of coverage.
        const cruft: string[] = [];
        for (const sha of registered) {
          if (!historicalShas.has(sha)) cruft.push(sha);
        }
        if (cruft.length > 0) {
          throw new Error(
            `Cruft detected: ${cruft.length} SHA(s) for ${path} are in the ` +
              `upgradable set but do not match any commit on main. ` +
              `Remove these entries:\n${cruft.map((s) => `  "${s}"`).join("\n")}`,
          );
        }
      });
    });
  }
});
