/**
 * Characterization harness integration tests.
 *
 * The harness itself is Python (packages/skill-catalog/characterization/
 * deterministic_harness.py) because the skills it invokes are Python.
 * This TS file exercises the empty-fixture state and the CLI contract
 * via subprocess so TS-side CI surfaces a regression in the shell-facing
 * behaviour (exit codes, stderr shape). The Python-level unit coverage
 * for the harness internals lives in the harness module's own guards
 * — see the `main()` path.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(
  HERE,
  "..",
  "characterization",
  "deterministic_harness.py",
);

function runHarness(
  args: string[],
  { fixturesRoot }: { fixturesRoot?: string } = {},
): { status: number; stdout: string; stderr: string } {
  // The harness resolves fixtures relative to its own file; for isolated
  // tests we stage a fresh tree at a tmp path and point the harness at
  // it by overriding the CATALOG_ROOT via Python's -c shim. Simpler
  // alternative for the empty-state test: invoke the real harness
  // against the repo — it discovers zero real fixtures today since U7
  // ships scaffolding only.
  const env = { ...process.env };
  if (fixturesRoot) {
    env.CHARACTERIZATION_FIXTURES_ROOT_OVERRIDE = fixturesRoot;
  }
  const result = spawnSync(
    "uv",
    ["run", "--no-project", "python", HARNESS, ...args],
    { env, encoding: "utf-8", timeout: 30_000 },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("characterization harness — scaffolding state", () => {
  it("exits 0 with a 'no fixtures' note when the fixtures dir is empty", () => {
    const result = runHarness([]);
    expect(result.status).toBe(0);
    // The note goes to stderr so CI log scrapers looking at stdout
    // see a clean green run, while humans running it locally see the
    // explanation of why nothing was checked.
    expect(result.stderr).toMatch(/no fixtures under/);
  });

  it("returns exit 2 when --slug names something that doesn't exist", () => {
    const result = runHarness(["--slug", "does-not-exist"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/no fixture found/);
  });
});

describe("characterization harness — regenerate guardrail", () => {
  it("refuses to regenerate without --confirm even when --regenerate is set", () => {
    // Seed a minimal fake fixture in a tmp dir so the regenerate path
    // actually tries to run — the guardrail must trip before it does.
    const tmp = mkdtempSync(join(tmpdir(), "char-harness-"));
    const slugDir = join(tmp, "demo");
    mkdirSync(slugDir);
    writeFileSync(join(slugDir, "inputs.json"), "{}");
    writeFileSync(join(slugDir, "golden.json"), "{}");
    try {
      const result = spawnSync(
        "uv",
        [
          "run",
          "--no-project",
          "python",
          "-c",
          [
            "import sys",
            `sys.path.insert(0, ${JSON.stringify(dirname(HARNESS))})`,
            "import deterministic_harness as h",
            "from pathlib import Path",
            `h.FIXTURES_ROOT = Path(${JSON.stringify(tmp)})`,
            "raise SystemExit(h.main(['--regenerate']))",
          ].join("\n"),
        ],
        { encoding: "utf-8", timeout: 30_000 },
      );
      // Non-zero exit. Either the CharacterizationError bubbles up
      // (what happens today) or a future refactor returns 2 — both
      // are correct. The thing we guard against is exit 0, which
      // would mean the regenerate went through silently.
      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/confirm/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
