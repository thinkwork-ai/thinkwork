#!/usr/bin/env node
/**
 * Capability matrix vocabulary check (capability-mapping plan U6).
 *
 * Parses the matrix table in docs/src/content/docs/concepts/capability-matrix.mdx
 * and asserts every layer cell begins with a canonical verb. Run by the
 * capability-matrix workflow; runnable locally:
 *
 *   node scripts/check-capability-matrix.mjs
 *
 * Dependency-free on purpose — the CI job needs no pnpm install.
 */

import { readFileSync } from "node:fs";

const DOC_PATH =
  process.argv[2] ?? "docs/src/content/docs/concepts/capability-matrix.mdx";

const CANONICAL_VERBS = [
  "Grant",
  "Carry",
  "Restrict",
  "Never",
  "On",
  "Install",
  "Activate",
  "Self-serve",
  "Platform-wired",
];

const EXPECTED_CLASSES = [
  "Skills",
  "Built-in tools",
  "MCP servers",
  "Pi extensions (bundled)",
  "Pi extensions (dynamic)",
  "Plugins (apps)",
  "Context / memory",
];

function fail(message) {
  console.error(`capability-matrix check FAILED: ${message}`);
  process.exit(1);
}

let content;
try {
  content = readFileSync(DOC_PATH, "utf8");
} catch (err) {
  fail(`cannot read ${DOC_PATH}: ${err.message}`);
}

// Locate the assignment matrix: the table whose header row starts with
// "| Class | Agent (default) |".
const lines = content.split("\n");
const headerIndex = lines.findIndex((line) =>
  /^\|\s*Class\s*\|\s*Agent \(default\)\s*\|/.test(line),
);
if (headerIndex === -1) {
  fail(
    'matrix table not found (no header row "| Class | Agent (default) | ...")',
  );
}

const header = lines[headerIndex]
  .split("|")
  .map((cell) => cell.trim())
  .filter(Boolean);
const expectedHeader = [
  "Class",
  "Agent (default)",
  "Agent Profile",
  "Space",
  "User",
];
if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
  fail(
    `matrix header columns changed. Expected ${JSON.stringify(expectedHeader)}, got ${JSON.stringify(header)}. Layer columns are part of the contract — update this checker deliberately if a layer is added.`,
  );
}

const rows = [];
for (let i = headerIndex + 2; i < lines.length; i += 1) {
  const line = lines[i];
  if (!line.trim().startsWith("|")) break;
  const cells = line.split("|").map((cell) => cell.trim());
  // Leading/trailing pipe produce empty first/last entries.
  const [className, ...layerCells] = cells.slice(1, -1);
  rows.push({ className, layerCells, lineNumber: i + 1 });
}

if (rows.length === 0) fail("matrix table has no rows");

const errors = [];

for (const expectedClass of EXPECTED_CLASSES) {
  if (!rows.some((row) => row.className === expectedClass)) {
    errors.push(
      `missing capability class row: "${expectedClass}" — removing a class is a contract change; update the checker's EXPECTED_CLASSES deliberately`,
    );
  }
}

const verbPattern = new RegExp(
  `^(${CANONICAL_VERBS.map((verb) => verb.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})\\b`,
);

for (const row of rows) {
  if (row.layerCells.length !== 4) {
    errors.push(
      `line ${row.lineNumber} ("${row.className}"): expected 4 layer cells, found ${row.layerCells.length}`,
    );
    continue;
  }
  for (const [layerIndex, cell] of row.layerCells.entries()) {
    const layer = expectedHeader[layerIndex + 1];
    if (!verbPattern.test(cell)) {
      errors.push(
        `line ${row.lineNumber} ("${row.className}" × ${layer}): cell "${cell}" must begin with a canonical verb (${CANONICAL_VERBS.join(", ")})`,
      );
    }
    // "On" is only meaningful with a restrictable qualifier.
    if (/^On\b/.test(cell) && !/restrictable/i.test(cell)) {
      errors.push(
        `line ${row.lineNumber} ("${row.className}" × ${layer}): "On" cells must state how they are restrictable`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`  - ${error}`);
  fail(`${errors.length} matrix vocabulary violation(s)`);
}

console.log(
  `capability-matrix check passed: ${rows.length} class rows × 4 layers conform to the canonical vocabulary`,
);
