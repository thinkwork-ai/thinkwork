import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_BUILDER_HISTORY_FOR_TESTING,
  type ArtifactBuilderManagedPath,
} from "./artifact-builder-defaults.js";

// Parity test: every historical version of each managed artifact-builder file
// that ever existed on `main` must be registered in the upgradable-SHA set.
// Without this, agents materialized off an unregistered platform default get
// stranded on stale content forever (PR #1551 backfilled the orphan SHA
// `4281155...` from commit 6b31f0f4 that hit Eric's dev agent on 2026-05-22).
//
// The test reads from the repo's `.git`, which is available in CI and locally
// when full history is fetched. Shallow clones (default for many CI checkouts)
// fail the `git log` walk; we skip with a clear message rather than silently
// passing.

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isShallowClone(): boolean {
  try {
    const out = git(["rev-parse", "--is-shallow-repository"]).trim();
    return out === "true";
  } catch {
    return true;
  }
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
      const registered =
        ARTIFACT_BUILDER_HISTORY_FOR_TESTING[path] ?? new Set<string>();
      const commits = commitsTouching(path);
      const headSha = shaAtHead(path);

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
    });
  }
});
