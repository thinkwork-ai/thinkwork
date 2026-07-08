#!/usr/bin/env tsx
/**
 * Generate the analyst semantic model (THINK-228 U1).
 *
 * Walks the Drizzle schema exports and writes the semantic-model markdown to
 * packages/database-pg/generated/analyst/SCHEMA.md. The committed copy is
 * kept honest by a vitest staleness test in
 * packages/database-pg/__tests__/analyst-semantic-model.test.ts (part of the
 * pre-commit `pnpm test` gate), so a schema change without a regen fails CI.
 *
 * Usage:
 *   npx tsx scripts/generate-analyst-schema.ts           # write/update
 *   npx tsx scripts/generate-analyst-schema.ts --check   # exit 1 if stale
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAnalystSchemaMarkdown } from "../packages/database-pg/src/analyst/semantic-model";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(
  HERE,
  "..",
  "packages",
  "database-pg",
  "generated",
  "analyst",
  "SCHEMA.md",
);

const checkMode = process.argv.includes("--check");
const generated = generateAnalystSchemaMarkdown();

if (checkMode) {
  const committed = existsSync(OUTPUT_PATH)
    ? readFileSync(OUTPUT_PATH, "utf-8")
    : null;
  if (committed !== generated) {
    console.error(
      `stale: ${OUTPUT_PATH} does not match the current Drizzle schema. ` +
        "Run: npx tsx scripts/generate-analyst-schema.ts",
    );
    process.exit(1);
  }
  console.log("analyst SCHEMA.md is up to date");
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`wrote ${OUTPUT_PATH}`);
}
