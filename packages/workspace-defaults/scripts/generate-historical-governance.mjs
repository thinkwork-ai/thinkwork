#!/usr/bin/env node
/**
 * Regenerate `src/historical.ts` from git history.
 *
 * The governance-file reseed (Composer plan 2026-07-02-001 U6) rewrites an
 * existing agent's AGENTS.md / CONTEXT.md only when its live content is
 * byte-identical to a PREVIOUSLY SHIPPED default version. This script
 * enumerates every committed version of the governance defaults from git
 * history and inlines them (Lambda bundles are self-contained — no `files/`
 * directory ships with them).
 *
 * Run it from the package directory whenever `files/AGENTS.md` or
 * `files/CONTEXT.md` changes:
 *
 *   node scripts/generate-historical-governance.mjs
 *
 * The `governance snapshot` parity test fails when the snapshot hash in
 * `src/historical.ts` no longer matches the current default content —
 * that is the reminder to re-run this script so the outgoing version
 * lands in the historical set.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: packageRoot,
  encoding: "utf8",
}).trim();

const GOVERNANCE_FILES = ["AGENTS.md", "CONTEXT.md"];

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function gitShow(commit, repoRelativePath) {
  try {
    return execFileSync("git", ["show", `${commit}:${repoRelativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function historicalVersions(fileName) {
  const absPath = join(packageRoot, "files", fileName);
  const repoRelativePath = relative(repoRoot, absPath).split("\\").join("/");
  const current = readFileSync(absPath, "utf8");

  const commits = execFileSync(
    "git",
    ["log", "--format=%H", "--", repoRelativePath],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .reverse(); // oldest first

  const seen = new Set();
  const versions = [];
  for (const commit of commits) {
    const content = gitShow(commit, repoRelativePath);
    if (content === null) continue;
    const hash = sha256(content);
    if (seen.has(hash)) continue;
    seen.add(hash);
    if (content === current) continue; // current content is not "historical"
    versions.push(content);
  }
  return { current, versions };
}

const byFile = new Map(
  GOVERNANCE_FILES.map((name) => [name, historicalVersions(name)]),
);

const lines = [];
lines.push("/**");
lines.push(
  " * GENERATED FILE — do not edit by hand. Regenerate with:",
  " *",
  " *   node scripts/generate-historical-governance.mjs",
  " *",
  " * Every previously shipped (committed) version of the governance",
  " * defaults, used by the reseed step (Composer plan 2026-07-02-001 U6)",
  " * to recognize never-customized agent files: a live AGENTS.md /",
  " * CONTEXT.md is rewritten to the current default only when it is",
  " * byte-identical to one of these versions after `{{AGENT_NAME}}` /",
  " * `{{TENANT_NAME}}` substitution with the agent's own values.",
  " */",
  "",
);
lines.push(
  "/** Governance files eligible for the byte-identical reseed. */",
  "export const RESEEDABLE_GOVERNANCE_FILES = [",
  ...GOVERNANCE_FILES.map((name) => `  ${JSON.stringify(name)},`),
  "] as const;",
  "",
  "export type ReseedableGovernanceFile =",
  "  (typeof RESEEDABLE_GOVERNANCE_FILES)[number];",
  "",
);

lines.push(
  "/**",
  " * SHA-256 of the current default content at generation time. The",
  " * parity suite compares this against `loadFile(...)` so any edit to a",
  " * governance default forces a regeneration of this module (moving the",
  " * outgoing version into the historical set).",
  " */",
  "export const GOVERNANCE_SNAPSHOT_SHA256: Record<",
  "  ReseedableGovernanceFile,",
  "  string",
  "> = {",
);
for (const name of GOVERNANCE_FILES) {
  const { current } = byFile.get(name);
  lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(sha256(current))},`);
}
lines.push("};", "");

lines.push(
  "/**",
  " * Previously shipped default content per governance file, oldest first,",
  " * deduplicated, excluding the current content. Raw (unsubstituted)",
  " * markdown — callers substitute placeholders per agent before comparing.",
  " */",
  "export const HISTORICAL_GOVERNANCE_DEFAULTS: Record<",
  "  ReseedableGovernanceFile,",
  "  readonly string[]",
  "> = {",
);
for (const name of GOVERNANCE_FILES) {
  const { versions } = byFile.get(name);
  lines.push(`  ${JSON.stringify(name)}: [`);
  for (const content of versions) {
    lines.push(`    ${JSON.stringify(content)},`);
  }
  lines.push("  ],");
}
lines.push("};", "");

writeFileSync(join(packageRoot, "src", "historical.ts"), lines.join("\n"));

for (const name of GOVERNANCE_FILES) {
  const { versions } = byFile.get(name);
  console.log(`${name}: ${versions.length} historical version(s)`);
}
console.log("Wrote src/historical.ts");
