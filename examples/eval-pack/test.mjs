/**
 * Eval pack validation script.
 * Checks that eval.yaml, dataset.jsonl, and all custom scorer modules are present and valid.
 *
 * Usage: node test.mjs
 */

import { readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log(`  PASS  ${msg}`);
  passed++;
}

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  failed++;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Parse minimal YAML key: value (top-level scalar fields only). */
function parseYamlFields(content) {
  const fields = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)/);
    if (m) fields[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

/** Convert a Python module path like "scorers.relevance" to a relative file path. */
function moduleToPath(modulePath) {
  return modulePath.split(".").join("/") + ".py";
}

async function validateEvalYaml() {
  console.log("\neval.yaml");
  const evalPath = join(__dirname, "eval.yaml");

  if (!(await fileExists(evalPath))) {
    fail("eval.yaml — file not found");
    return null;
  }
  pass("eval.yaml — file exists");

  const content = await readFile(evalPath, "utf8");
  const fields = parseYamlFields(content);

  for (const field of ["name", "dataset", "scorers"]) {
    if (content.includes(`${field}:`)) {
      pass(`eval.yaml — field '${field}' present`);
    } else {
      fail(`eval.yaml — missing required field '${field}'`);
    }
  }

  return content;
}

async function validateDataset(evalContent) {
  console.log("\ndataset.jsonl");
  const datasetField = evalContent
    ? parseYamlFields(evalContent).dataset || "dataset.jsonl"
    : "dataset.jsonl";
  const datasetPath = join(__dirname, datasetField);

  if (!(await fileExists(datasetPath))) {
    fail(`${datasetField} — file not found`);
    return;
  }
  pass(`${datasetField} — file exists`);

  const content = await readFile(datasetPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    fail(`${datasetField} — no test cases found`);
    return;
  }
  pass(`${datasetField} — ${lines.length} test case(s) found`);

  let parseErrors = 0;
  let missingId = 0;
  let missingInput = 0;

  for (let i = 0; i < lines.length; i++) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      parseErrors++;
      fail(`${datasetField} line ${i + 1} — invalid JSON`);
      continue;
    }
    if (!obj.id) missingId++;
    if (!obj.input) missingInput++;
  }

  if (parseErrors === 0) pass(`${datasetField} — all lines are valid JSON`);
  if (missingId === 0) {
    pass(`${datasetField} — all test cases have 'id' field`);
  } else {
    fail(`${datasetField} — ${missingId} test case(s) missing 'id' field`);
  }
  if (missingInput === 0) {
    pass(`${datasetField} — all test cases have 'input' field`);
  } else {
    fail(`${datasetField} — ${missingInput} test case(s) missing 'input' field`);
  }
}

async function validateCustomScorers(evalContent) {
  if (!evalContent) return;

  // Find custom scorer modules by scanning for "module:" lines
  const moduleMatches = [...evalContent.matchAll(/module:\s*(\S+)/g)];
  if (moduleMatches.length === 0) return;

  console.log("\nCustom scorers");
  for (const match of moduleMatches) {
    const modulePath = match[1];
    const filePath = join(__dirname, moduleToPath(modulePath));
    if (await fileExists(filePath)) {
      pass(`${moduleToPath(modulePath)} — file exists`);
    } else {
      fail(`${moduleToPath(modulePath)} — file not found (module: ${modulePath})`);
    }
  }
}

async function main() {
  console.log("Thinkwork Eval Pack Validator\n");

  const evalContent = await validateEvalYaml();
  await validateDataset(evalContent);
  await validateCustomScorers(evalContent);

  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
