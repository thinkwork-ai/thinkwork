#!/usr/bin/env tsx
/**
 * Reads each skill's SKILL.md frontmatter and outputs index.json to stdout.
 *
 * Post plan 2026-04-24-009 §U2: SKILL.md frontmatter is the canonical
 * metadata source — `skill.yaml` was retired. This script no longer
 * carries its own hand-rolled YAML parser; it reuses U1's
 * `parseSkillMdInternal` so any frontmatter shape the runtime accepts
 * is reflected in the generated index.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(__dirname, "..");

const entries = readdirSync(catalogRoot).filter((name) => {
  if (
    name === "scripts" ||
    name === "node_modules" ||
    name === "__tests__" ||
    name.startsWith(".")
  )
    return false;
  const fullPath = join(catalogRoot, name);
  return (
    statSync(fullPath).isDirectory() &&
    statSync(join(fullPath, "SKILL.md")).isFile()
  );
});

const index = entries
  .map((dir) => {
    const mdPath = join(catalogRoot, dir, "SKILL.md");
    const result = parseSkillMdInternal(readFileSync(mdPath, "utf-8"), mdPath);
    if (!result.valid) {
      console.error(
        `[generate-index] skipping ${dir}: SKILL.md frontmatter parse failed — ` +
          result.errors.map((e) => e.message).join("; "),
      );
      return null;
    }
    return result.parsed.data;
  })
  .filter((v): v is Record<string, unknown> => v !== null);

process.stdout.write(JSON.stringify(index, null, 2) + "\n");
