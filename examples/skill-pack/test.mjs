/**
 * Skill pack validation script.
 * Validates that each skill directory contains the required files and fields.
 *
 * Usage: node test.mjs
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_SKILL_YAML_FIELDS = ["slug", "display_name", "description", "category", "version"];

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

/** Parse a minimal YAML key: value file (no nesting needed for required fields). */
function parseYamlFields(content) {
  const fields = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)/);
    if (m) fields[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

/** Check that a SKILL.md file has YAML frontmatter with name and description. */
function validateSkillMd(content, skillName) {
  if (!content.startsWith("---")) {
    fail(`${skillName}/SKILL.md — missing YAML frontmatter`);
    return;
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    fail(`${skillName}/SKILL.md — frontmatter not closed`);
    return;
  }
  const frontmatter = content.slice(3, end);
  const fields = parseYamlFields(frontmatter);
  if (fields.name) {
    pass(`${skillName}/SKILL.md — frontmatter.name present ("${fields.name}")`);
  } else {
    fail(`${skillName}/SKILL.md — frontmatter missing 'name'`);
  }
  if (fields.description || frontmatter.includes("description:")) {
    pass(`${skillName}/SKILL.md — frontmatter.description present`);
  } else {
    fail(`${skillName}/SKILL.md — frontmatter missing 'description'`);
  }
}

async function validateSkillDir(dirPath) {
  const name = dirPath.split("/").pop();
  console.log(`\nSkill: ${name}`);

  // Check skill.yaml exists
  const yamlPath = join(dirPath, "skill.yaml");
  if (!(await fileExists(yamlPath))) {
    fail(`${name}/skill.yaml — file not found`);
    return;
  }
  pass(`${name}/skill.yaml — file exists`);

  // Parse and validate required fields
  const yamlContent = await readFile(yamlPath, "utf8");
  const fields = parseYamlFields(yamlContent);
  for (const field of REQUIRED_SKILL_YAML_FIELDS) {
    if (fields[field]) {
      pass(`${name}/skill.yaml — field '${field}' present`);
    } else {
      fail(`${name}/skill.yaml — missing required field '${field}'`);
    }
  }

  // Check SKILL.md exists
  const mdPath = join(dirPath, "SKILL.md");
  if (!(await fileExists(mdPath))) {
    fail(`${name}/SKILL.md — file not found`);
    return;
  }
  pass(`${name}/SKILL.md — file exists`);

  const mdContent = await readFile(mdPath, "utf8");
  validateSkillMd(mdContent, name);
}

async function main() {
  console.log("Thinkwork Skill Pack Validator\n");

  const entries = await readdir(__dirname, { withFileTypes: true });
  const skillDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => join(__dirname, e.name));

  if (skillDirs.length === 0) {
    console.error("No skill directories found.");
    process.exit(1);
  }

  for (const dir of skillDirs) {
    await validateSkillDir(dir);
  }

  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
