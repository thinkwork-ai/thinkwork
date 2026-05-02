import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0061 = readFileSync(
  join(HERE, "..", "drizzle", "0061_routine_execution_asl_version_id.sql"),
  "utf-8",
);
const rollback0061 = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0061_routine_execution_asl_version_id_rollback.sql",
  ),
  "utf-8",
);

describe("migration 0061 — routine execution ASL version capture", () => {
  it("declares every drift-detected object", () => {
    expect(migration0061).toMatch(
      /--\s*creates-column:\s*public\.routine_executions\.routine_asl_version_id\b/,
    );
    expect(migration0061).toMatch(
      /--\s*creates:\s*public\.idx_routine_executions_asl_version\b/,
    );
  });

  it("uses idempotent DDL for the nullable FK column and lookup index", () => {
    expect(migration0061).toMatch(
      /ADD COLUMN IF NOT EXISTS routine_asl_version_id uuid REFERENCES public\.routine_asl_versions\(id\)/i,
    );
    expect(migration0061).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_routine_executions_asl_version/i,
    );
    expect(migration0061).not.toMatch(/\bDROP\b/i);
  });

  it("rolls back the index before the column", () => {
    const dropIndexOffset = rollback0061.indexOf(
      "DROP INDEX IF EXISTS public.idx_routine_executions_asl_version",
    );
    const dropColumnOffset = rollback0061.indexOf(
      "DROP COLUMN IF EXISTS routine_asl_version_id",
    );

    expect(dropIndexOffset).toBeGreaterThanOrEqual(0);
    expect(dropColumnOffset).toBeGreaterThanOrEqual(0);
    expect(dropIndexOffset).toBeLessThan(dropColumnOffset);
  });
});
