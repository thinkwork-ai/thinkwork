import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0249_capability_headless_execution_evidence.sql",
  ),
  "utf-8",
);

const COLUMNS = [
  "public.routine_executions.capability_dependencies_json",
  "public.routine_executions.config_fingerprint",
  "public.routine_executions.readiness_outcome",
  "public.routine_executions.remediation_json",
  "public.routine_executions.broker_session_id",
  "public.routine_step_events.broker_call_id",
  "public.routine_step_events.artifact_id",
];

describe("migration 0249 — capability-headless execution evidence", () => {
  it("declares a creates-column marker for every additive column", () => {
    for (const col of COLUMNS) {
      expect(migration).toContain(`-- creates-column: ${col}`);
    }
  });

  it("is purely additive on existing tables (no drops, no new tables)", () => {
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).toMatch(/ALTER TABLE public\.routine_executions/);
    expect(migration).toMatch(/ALTER TABLE public\.routine_step_events/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });
});
