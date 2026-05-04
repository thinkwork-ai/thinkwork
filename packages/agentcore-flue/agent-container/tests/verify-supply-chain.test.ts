import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Plan §005 U10 — verify-supply-chain.sh contract tests.
 *
 * The script is the second integrity gate (the first is `pnpm install
 * --frozen-lockfile`). It compares an explicit allow-list of
 * trusted-handler critical-path packages against the live
 * `pnpm-lock.yaml`. These tests pin the contract:
 *
 *   - Happy path: real baseline + real lockfile -> exit 0, summary on stdout.
 *   - Failure path: a synthetic baseline with a mutated integrity hash
 *     fails with non-zero exit and `integrity mismatch` on stderr.
 *
 * The script accepts a baseline path as the first arg or via the
 * SUPPLY_CHAIN_BASELINE env var so the failure-path test can point at
 * a tmp-file fixture without touching the real baseline.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/verify-supply-chain.sh");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/supply-chain-baseline.txt");
const LOCKFILE_PATH = path.join(REPO_ROOT, "pnpm-lock.yaml");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runScript(args: string[]): RunResult {
  try {
    const stdout = execFileSync("bash", [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}

describe("verify-supply-chain.sh", () => {
  beforeAll(() => {
    // The script lives in the repo and the lockfile + baseline must exist
    // for these tests to mean anything. Fail loud if any are missing.
    expect(() =>
      readFileSync(SCRIPT_PATH, "utf8"),
    ).not.toThrow();
    expect(() =>
      readFileSync(BASELINE_PATH, "utf8"),
    ).not.toThrow();
    expect(() =>
      readFileSync(LOCKFILE_PATH, "utf8"),
    ).not.toThrow();
  });

  it("happy path: real baseline + real lockfile exits 0 with a verified summary", () => {
    const result = runScript([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/OK . verified \d+ package\(s\)/);
  });

  it("happy path: explicit baseline + lockfile args route correctly", () => {
    const result = runScript([BASELINE_PATH, LOCKFILE_PATH]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("failure path: mutated integrity hash exits non-zero with integrity mismatch on stderr", () => {
    // Take the real baseline, flip the last hex character of the first
    // package's integrity hash, write it to a tmpfile, and re-run the
    // script with that tmpfile as the baseline arg.
    const realBaseline = readFileSync(BASELINE_PATH, "utf8");
    const lines = realBaseline.split("\n");
    const targetIndex = lines.findIndex((line) => line.startsWith("@"));
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const targetLine = lines[targetIndex]!;
    const tokens = targetLine.split(/\s+/);
    expect(tokens).toHaveLength(2);
    const integrity = tokens[1]!;
    // Flip the last alpha-numeric character before the trailing `==`.
    const matched = integrity.match(/^(.*?)(.)(==)?$/);
    expect(matched).not.toBeNull();
    const [, head, lastChar, tail] = matched!;
    const flipped = lastChar === "A" ? "B" : "A";
    const mutatedIntegrity = `${head}${flipped}${tail ?? ""}`;
    expect(mutatedIntegrity).not.toBe(integrity);
    lines[targetIndex] = `${tokens[0]} ${mutatedIntegrity}`;

    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    writeFileSync(tmpBaseline, lines.join("\n"));

    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("integrity mismatch");
    expect(result.stderr).toContain(tokens[0]!);
  });

  it("failure path: missing baseline file exits non-zero with a descriptive error", () => {
    const result = runScript([
      "/tmp/this-baseline-does-not-exist-supply-chain-test",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("baseline file not found");
  });

  it("failure path: missing lockfile file exits non-zero with a descriptive error", () => {
    const result = runScript([
      BASELINE_PATH,
      "/tmp/this-lockfile-does-not-exist-supply-chain-test",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lockfile not found");
  });

  it("failure path: malformed baseline (single column) exits non-zero", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    writeFileSync(tmpBaseline, "@thinkwork/onlyname@1.0.0\n");
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/malformed baseline entry/);
  });

  it("failure path: extra columns (e.g. inline comment) reject the entry rather than silently truncating", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    const real = readFileSync(BASELINE_PATH, "utf8");
    const firstReal = real
      .split("\n")
      .find((line) => line.startsWith("@"))!;
    // Append a third token that should NOT be silently dropped.
    writeFileSync(tmpBaseline, `${firstReal} suspicious-third-column\n`);
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/expected 2 columns, got 3/);
  });

  it("failure path: non-sha512 baseline integrity rejected", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    writeFileSync(
      tmpBaseline,
      "@mariozechner/pi-agent-core@0.70.2 sha256-shorterhashthatshouldbedisallowed\n",
    );
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not a sha512- value");
  });

  it("CRLF baseline does not produce a false integrity-mismatch", () => {
    // A Windows-edited baseline with CRLF line endings would historically
    // surface as `integrity mismatch` against an apparently-identical hash
    // (the CR was being included in `expected_integrity`). The fix strips
    // trailing CR before parsing.
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    const real = readFileSync(BASELINE_PATH, "utf8");
    const firstReal = real
      .split("\n")
      .find((line) => line.startsWith("@"))!;
    writeFileSync(tmpBaseline, `${firstReal}\r\n`);
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/verified 1 package/);
  });

  it("failure path: baseline references a package not in the lockfile exits non-zero", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    writeFileSync(
      tmpBaseline,
      "@thinkwork/this-package-does-not-exist@9.9.9 sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\n",
    );
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found in");
  });

  it("ignores blank lines and # comments in the baseline", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    // Pull one real entry from the actual baseline so this test rides on
    // truth, not on a hard-coded hash that drifts when we bump versions.
    const real = readFileSync(BASELINE_PATH, "utf8");
    const firstReal = real
      .split("\n")
      .find((line) => line.startsWith("@"))!;
    writeFileSync(
      tmpBaseline,
      [
        "# leading comment",
        "",
        "  # indented comment",
        firstReal,
        "",
        "# trailing comment",
        "",
      ].join("\n"),
    );
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/verified 1 package/);
  });

  it("refuses an empty baseline (would otherwise trivially pass)", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "verify-supply-chain-"));
    const tmpBaseline = path.join(tmpDir, "baseline.txt");
    writeFileSync(tmpBaseline, "# nothing here\n\n");
    const result = runScript([tmpBaseline]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no entries");
  });
});
