/**
 * Connector recipe validation script.
 * Checks that all required handler, skill, and terraform files are present.
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

async function checkFile(relativePath, description) {
  const fullPath = join(__dirname, relativePath);
  if (await fileExists(fullPath)) {
    pass(`${relativePath} — ${description}`);
    return true;
  } else {
    fail(`${relativePath} — ${description} (file not found)`);
    return false;
  }
}

async function validateSkillMd() {
  const mdPath = join(__dirname, "skill/SKILL.md");
  if (!(await fileExists(mdPath))) {
    fail("skill/SKILL.md — file not found");
    return;
  }
  pass("skill/SKILL.md — file exists");

  const content = await readFile(mdPath, "utf8");
  if (!content.startsWith("---")) {
    fail("skill/SKILL.md — missing YAML frontmatter");
    return;
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    fail("skill/SKILL.md — frontmatter not closed");
    return;
  }
  const frontmatter = content.slice(3, end);
  if (frontmatter.includes("name:")) {
    pass("skill/SKILL.md — frontmatter has 'name'");
  } else {
    fail("skill/SKILL.md — frontmatter missing 'name'");
  }
  if (frontmatter.includes("description:")) {
    pass("skill/SKILL.md — frontmatter has 'description'");
  } else {
    fail("skill/SKILL.md — frontmatter missing 'description'");
  }
}

async function main() {
  console.log("Thinkwork Connector Recipe Validator\n");

  // Handler files
  console.log("\nHandler");
  await checkFile("handler/main.py", "Lambda entry point");
  await checkFile("handler/auth.py", "Webhook signature verification");
  await checkFile("handler/thread.py", "Thinkwork thread API helpers");
  await checkFile("handler/requirements.txt", "Python dependencies");

  // Skill
  console.log("\nSkill");
  await validateSkillMd();

  // Terraform
  console.log("\nTerraform");
  await checkFile("terraform/main.tf", "Lambda + API Gateway infrastructure");
  await checkFile("terraform/variables.tf", "Input variable definitions");
  await checkFile("terraform/outputs.tf", "Stack outputs (webhook URL)");

  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
