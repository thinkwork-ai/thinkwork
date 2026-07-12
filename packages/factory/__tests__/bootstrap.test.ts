import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "worker-bootstrap.sh");

// Named exit codes — keep in sync with scripts/worker-bootstrap.sh.
const EXIT = {
  USAGE: 64,
  REPO_NOT_GIT: 65,
  FETCH_FAILED: 66,
  TARGET_EXISTS: 67,
  BRANCH_EXISTS: 68,
  WORKTREE_ADD_FAILED: 69,
  TSBUILDINFO_PURGE_FAILED: 70,
  ENV_SOURCE_MISSING: 71,
  ENV_COPY_FAILED: 72,
  PORT_BUSY: 73,
} as const;

let fixtureRoot: string;
let originDir: string;
let mainCheckout: string;
let worktreesDir: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** Run the bootstrap script; return { status, stderr }. */
function runBootstrap(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: String(err.stderr ?? "") };
  }
}

function baseArgs(target: string, branch: string, extra: string[] = []) {
  return [
    "--repo",
    mainCheckout,
    "--worktree",
    target,
    "--branch",
    branch,
    "--base",
    "origin/main",
    ...extra,
  ];
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "factory-bootstrap-test-"));
  const seed = join(fixtureRoot, "seed");
  mkdirSync(seed, { recursive: true });
  execSync("git init -b main -q .", { cwd: seed });
  execSync('git config user.email "test@test" && git config user.name "t"', {
    cwd: seed,
  });
  mkdirSync(join(seed, "apps", "web"), { recursive: true });
  mkdirSync(join(seed, "apps", "mobile"), { recursive: true });
  mkdirSync(join(seed, "packages", "foo", "dist"), { recursive: true });
  writeFileSync(join(seed, "README.md"), "fixture\n");
  writeFileSync(join(seed, "apps", "web", ".gitkeep"), "");
  writeFileSync(join(seed, "apps", "mobile", ".gitkeep"), "");
  // Stale incremental-build state committed so it materializes in new worktrees.
  writeFileSync(
    join(seed, "packages", "foo", "dist", "tsconfig.tsbuildinfo"),
    "{}",
  );
  execSync("git add -A && git commit -q -m seed", { cwd: seed });

  originDir = join(fixtureRoot, "origin.git");
  execSync(`git clone -q --bare "${seed}" "${originDir}"`, {
    cwd: fixtureRoot,
  });

  mainCheckout = join(fixtureRoot, "main-checkout");
  execSync(`git clone -q "${originDir}" "${mainCheckout}"`, {
    cwd: fixtureRoot,
  });
  // Ignored env files live only in the main checkout (never committed).
  writeFileSync(join(mainCheckout, "apps", "web", ".env"), "VITE_X=1\n");
  writeFileSync(join(mainCheckout, "apps", "mobile", ".env"), "EXPO_Y=2\n");

  worktreesDir = join(fixtureRoot, "worktrees");
  mkdirSync(worktreesDir, { recursive: true });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

afterEach(() => {
  // Prune worktree registrations so branch/worktree leftovers never cascade.
  try {
    execSync("git worktree prune", { cwd: mainCheckout });
  } catch {
    /* fixture teardown is best-effort */
  }
});

describe("worker-bootstrap.sh", () => {
  it("bootstraps a worktree: branch created, tsbuildinfo purged, env files copied", async () => {
    const target = join(worktreesDir, "auto-happy-implement-a1");
    const port = await getFreePort();
    const res = runBootstrap(
      baseArgs(target, "auto/happy-implement-a1", ["--port", String(port)]),
    );
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);

    expect(existsSync(target)).toBe(true);
    expect(git(target, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "auto/happy-implement-a1",
    );
    // Purged stale build state.
    expect(
      existsSync(
        join(target, "packages", "foo", "dist", "tsconfig.tsbuildinfo"),
      ),
    ).toBe(false);
    // Copied env files from the main checkout.
    expect(readFileSync(join(target, "apps", "web", ".env"), "utf-8")).toBe(
      "VITE_X=1\n",
    );
    expect(readFileSync(join(target, "apps", "mobile", ".env"), "utf-8")).toBe(
      "EXPO_Y=2\n",
    );
  });

  it("tolerates a missing apps/mobile/.env (optional copy)", async () => {
    rmSync(join(mainCheckout, "apps", "mobile", ".env"));
    try {
      const target = join(worktreesDir, "auto-nomobile-implement-a1");
      const res = runBootstrap(baseArgs(target, "auto/nomobile-implement-a1"));
      expect(res.status).toBe(0);
      expect(existsSync(join(target, "apps", "mobile", ".env"))).toBe(false);
      expect(existsSync(join(target, "apps", "web", ".env"))).toBe(true);
    } finally {
      writeFileSync(join(mainCheckout, "apps", "mobile", ".env"), "EXPO_Y=2\n");
    }
  });

  it("refuses with ENV_SOURCE_MISSING when apps/web/.env is absent — before creating anything", () => {
    rmSync(join(mainCheckout, "apps", "web", ".env"));
    try {
      const target = join(worktreesDir, "auto-noenv-implement-a1");
      const res = runBootstrap(baseArgs(target, "auto/noenv-implement-a1"));
      expect(res.status).toBe(EXIT.ENV_SOURCE_MISSING);
      expect(res.stderr).toMatch(/env-source-missing/);
      expect(existsSync(target)).toBe(false);
    } finally {
      writeFileSync(join(mainCheckout, "apps", "web", ".env"), "VITE_X=1\n");
    }
  });

  it("refuses with PORT_BUSY when the requested dev port is occupied", async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    try {
      const target = join(worktreesDir, "auto-port-implement-a1");
      const res = runBootstrap(
        baseArgs(target, "auto/port-implement-a1", ["--port", String(port)]),
      );
      expect(res.status).toBe(EXIT.PORT_BUSY);
      expect(res.stderr).toMatch(/port-busy/);
      expect(existsSync(target)).toBe(false);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("refuses with TARGET_EXISTS on an existing (dirty) target path", () => {
    const target = join(worktreesDir, "auto-dirty-implement-a1");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "leftover.txt"), "dirty");
    const res = runBootstrap(baseArgs(target, "auto/dirty-implement-a1"));
    expect(res.status).toBe(EXIT.TARGET_EXISTS);
    expect(res.stderr).toMatch(/target-exists/);
    // The dirty path is left untouched for forensics.
    expect(existsSync(join(target, "leftover.txt"))).toBe(true);
  });

  it("refuses with BRANCH_EXISTS when the attempt branch already exists", () => {
    git(mainCheckout, ["branch", "auto/dup-implement-a1"]);
    const target = join(worktreesDir, "auto-dup-implement-a1");
    const res = runBootstrap(baseArgs(target, "auto/dup-implement-a1"));
    expect(res.status).toBe(EXIT.BRANCH_EXISTS);
    expect(res.stderr).toMatch(/branch-exists/);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses with REPO_NOT_GIT when --repo is not a git checkout", () => {
    const notRepo = join(fixtureRoot, "not-a-repo");
    mkdirSync(notRepo, { recursive: true });
    const res = runBootstrap([
      "--repo",
      notRepo,
      "--worktree",
      join(worktreesDir, "auto-x"),
      "--branch",
      "auto/x",
    ]);
    expect(res.status).toBe(EXIT.REPO_NOT_GIT);
    expect(res.stderr).toMatch(/repo-not-git/);
  });

  it("refuses with USAGE when required arguments are missing", () => {
    const res = runBootstrap(["--repo", mainCheckout]);
    expect(res.status).toBe(EXIT.USAGE);
    expect(res.stderr).toMatch(/usage/i);
  });

  it("relaunch: attempt a2 bootstraps beside a1 and leaves a1's worktree untouched", () => {
    const a1 = join(worktreesDir, "auto-relaunch-implement-a1");
    const a2 = join(worktreesDir, "auto-relaunch-implement-a2");
    expect(
      runBootstrap(baseArgs(a1, "auto/relaunch-implement-a1")).status,
    ).toBe(0);
    // Simulate in-progress work in attempt 1 (forensic evidence).
    writeFileSync(join(a1, "wip-marker.txt"), "attempt-1 evidence");

    expect(
      runBootstrap(baseArgs(a2, "auto/relaunch-implement-a2")).status,
    ).toBe(0);
    expect(existsSync(a2)).toBe(true);
    expect(git(a2, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "auto/relaunch-implement-a2",
    );
    // Attempt 1's worktree is preserved, marker intact.
    expect(readFileSync(join(a1, "wip-marker.txt"), "utf-8")).toBe(
      "attempt-1 evidence",
    );
    expect(git(a1, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "auto/relaunch-implement-a1",
    );
  });
});
