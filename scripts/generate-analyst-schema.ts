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

import {
  ANALYST_GRANTS_BEGIN_MARKER,
  ANALYST_GRANTS_END_MARKER,
  analystGrantSql,
  generateAnalystSchemaMarkdown,
} from "../packages/database-pg/src/analyst/semantic-model";

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
const MIGRATION_PATH = join(
  HERE,
  "..",
  "packages",
  "database-pg",
  "drizzle",
  "0227_analyst_reader_role.sql",
);

function spliceGrantSection(migration: string): string {
  const begin = migration.indexOf(ANALYST_GRANTS_BEGIN_MARKER);
  const end = migration.indexOf(ANALYST_GRANTS_END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`grant markers missing or malformed in ${MIGRATION_PATH}`);
  }
  return (
    migration.slice(0, begin + ANALYST_GRANTS_BEGIN_MARKER.length) +
    "\n" +
    analystGrantSql() +
    "\n" +
    migration.slice(end)
  );
}

const checkMode = process.argv.includes("--check");
const generated = generateAnalystSchemaMarkdown();
const migration = readFileSync(MIGRATION_PATH, "utf-8");
const splicedMigration = spliceGrantSection(migration);

if (checkMode) {
  const committed = existsSync(OUTPUT_PATH)
    ? readFileSync(OUTPUT_PATH, "utf-8")
    : null;
  if (committed !== generated || migration !== splicedMigration) {
    console.error(
      "stale: the analyst SCHEMA.md and/or the 0227 grant section do not match " +
        "the current Drizzle schema. Run: npx tsx scripts/generate-analyst-schema.ts",
    );
    process.exit(1);
  }
  console.log("analyst SCHEMA.md + 0227 grant section are up to date");
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`wrote ${OUTPUT_PATH}`);
  if (migration !== splicedMigration) {
    writeFileSync(MIGRATION_PATH, splicedMigration);
    console.log(`updated grant section in ${MIGRATION_PATH}`);
  }
}
