/**
 * Deterministic routines v1 schema (plan 2026-07-03-004 U1).
 *
 * Asserts the git_python engine substrate: pointer columns on routines,
 * SHA capture on routine_executions, the routine_code_cache SHA index, the
 * routine_repair_events ladder history, and that the hand-rolled 0205
 * migration matches the Drizzle schema it claims to create.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { routines } from "../src/schema/routines";
import { routineExecutions } from "../src/schema/routine-executions";
import { routineCodeCache } from "../src/schema/routine-code-cache";
import { routineRepairEvents } from "../src/schema/routine-repair-events";

// Concatenate the literal-string chunks of a drizzle sql`` template so the
// CHECK expression text is assertable (the interpolated column objects are
// circular and can't be JSON.stringified).
function sqlChunkText(value: { queryChunks: unknown[] }): string {
  return value.queryChunks
    .map((chunk) =>
      chunk && typeof chunk === "object" && "value" in chunk
        ? (chunk as { value: string[] }).value.join("")
        : "",
    )
    .join("");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0205 = readFileSync(
  join(HERE, "..", "drizzle", "0205_routines_git_python.sql"),
  "utf-8",
);

describe("routines git_python columns", () => {
  it("admits git_python in the engine CHECK", () => {
    const { checks } = getTableConfig(routines);
    const engineCheck = checks.find((c) => c.name === "routines_engine_enum");
    expect(engineCheck).toBeDefined();
    const sqlText = sqlChunkText(engineCheck!.value);
    expect(sqlText).toContain("git_python");
  });

  it("carries nullable pointer columns, never code", () => {
    const columns = getTableColumns(routines);
    for (const name of [
      "module_path",
      "fixture_paths",
      "credential_refs",
      "validated_sha",
      "disabled_reason",
    ] as const) {
      expect(columns[name], name).toBeDefined();
      expect(columns[name].notNull, `${name} must be nullable`).toBe(false);
    }
  });
});

describe("routine_executions SHA capture", () => {
  it("records commit_sha / validated_sha / cache_served, all nullable", () => {
    const columns = getTableColumns(routineExecutions);
    for (const name of [
      "commit_sha",
      "validated_sha",
      "cache_served",
    ] as const) {
      expect(columns[name], name).toBeDefined();
      expect(columns[name].notNull, `${name} must be nullable`).toBe(false);
    }
  });

  it("relaxes the SFN-only NOT NULLs for git_python rows", () => {
    const columns = getTableColumns(routineExecutions);
    expect(columns.state_machine_arn.notNull).toBe(false);
    expect(columns.sfn_execution_arn.notNull).toBe(false);
  });
});

describe("routine_code_cache", () => {
  it("indexes the S3 SHA cache uniquely per (routine, sha)", () => {
    expect(getTableName(routineCodeCache)).toBe("routine_code_cache");
    const { indexes } = getTableConfig(routineCodeCache);
    const unique = indexes.find(
      (i) => i.config.name === "idx_routine_code_cache_routine_sha",
    );
    expect(unique).toBeDefined();
    expect(unique!.config.unique).toBe(true);
  });

  it("tracks the fixture-gate outcome with a pending default", () => {
    const columns = getTableColumns(routineCodeCache);
    expect(columns.fixture_status.notNull).toBe(true);
    expect(columns.fixture_status.default).toBe("pending");
    expect(columns.s3_key.notNull).toBe(true);
    expect(columns.sha.notNull).toBe(true);
    const { checks } = getTableConfig(routineCodeCache);
    const statusCheck = checks.find(
      (c) => c.name === "routine_code_cache_fixture_status_enum",
    );
    expect(statusCheck).toBeDefined();
  });
});

describe("routine_repair_events", () => {
  it("models the repair ladder event types", () => {
    expect(getTableName(routineRepairEvents)).toBe("routine_repair_events");
    const { checks } = getTableConfig(routineRepairEvents);
    const typeCheck = checks.find(
      (c) => c.name === "routine_repair_events_event_type_enum",
    );
    expect(typeCheck).toBeDefined();
    const sqlText = sqlChunkText(typeCheck!.value);
    for (const t of [
      "retry",
      "revert",
      "repair_attempt",
      "pending_commit",
      "disabled",
      "infra_failure",
    ]) {
      expect(sqlText).toContain(t);
    }
  });

  it("keeps execution linkage optional (budget disables have no run)", () => {
    const columns = getTableColumns(routineRepairEvents);
    expect(columns.execution_id.notNull).toBe(false);
    expect(columns.routine_id.notNull).toBe(true);
    expect(columns.tenant_id.notNull).toBe(true);
  });
});

describe("migration 0205", () => {
  it("declares drift-gate markers for everything it creates", () => {
    for (const marker of [
      "-- creates-column: public.routines.module_path",
      "-- creates-column: public.routines.fixture_paths",
      "-- creates-column: public.routines.credential_refs",
      "-- creates-column: public.routines.validated_sha",
      "-- creates-column: public.routines.disabled_reason",
      "-- creates-column: public.routine_executions.commit_sha",
      "-- creates-column: public.routine_executions.validated_sha",
      "-- creates-column: public.routine_executions.cache_served",
      "-- creates: public.routine_code_cache",
      "-- creates: public.routine_repair_events",
    ]) {
      expect(migration0205).toContain(marker);
    }
  });

  it("extends the engine CHECK and relaxes the SFN NOT NULLs", () => {
    expect(migration0205).toContain(
      "CHECK (engine IN ('legacy_python', 'step_functions', 'git_python'))",
    );
    expect(migration0205).toContain(
      "ALTER COLUMN state_machine_arn DROP NOT NULL",
    );
    expect(migration0205).toContain(
      "ALTER COLUMN sfn_execution_arn DROP NOT NULL",
    );
  });
});
