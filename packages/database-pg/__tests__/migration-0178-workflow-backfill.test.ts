import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0178 = readFileSync(
  join(HERE, "..", "drizzle", "0178_workflow_backfill_existing_routines.sql"),
  "utf-8",
);
const rollback0178 = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0178_workflow_backfill_existing_routines_rollback.sql",
  ),
  "utf-8",
);

describe("migration 0178 - workflow backfill existing routines", () => {
  it("declares a drift-checkable status view marker for the data migration", () => {
    expect(migration0178).toContain(
      "-- creates: public.view_workflow_backfill_existing_routines_status",
    );
    expect(migration0178).toMatch(
      /CREATE OR REPLACE VIEW public\.view_workflow_backfill_existing_routines_status/i,
    );
    expect(migration0178).toContain("missing_step_functions_bindings");
    expect(migration0178).toContain(
      "enabled_scheduled_routines_without_version_pin",
    );
  });

  it("fails preflight before partial writes when prerequisite tables are missing", () => {
    for (const relation of [
      "public.routines",
      "public.routine_asl_versions",
      "public.scheduled_jobs",
      "public.workflows",
      "public.workflow_versions",
      "public.workflow_triggers",
      "public.workflow_engine_bindings",
    ]) {
      expect(migration0178).toContain(`to_regclass('${relation}')`);
    }
    expect(migration0178).toMatch(/RAISE EXCEPTION/i);
  });

  it("backfills only Step Functions routines and records legacy Python as skipped status", () => {
    expect(migration0178).toMatch(/WHERE r\.engine = 'step_functions'/);
    expect(migration0178).not.toMatch(
      /WHERE r\.engine IN \('step_functions', 'legacy_python'\)/,
    );
    expect(migration0178).toContain("skipped_legacy_python_routines");
  });

  it("uses the same routine slug and binding identity as the application adapter", () => {
    expect(migration0178).toContain("'routine-' || er.id::text");
    expect(migration0178).toContain("'routine-' || r.id::text");
    expect(migration0178).toContain(
      "ON CONFLICT (tenant_id, routine_id) WHERE routine_id IS NOT NULL",
    );
    expect(migration0178).toContain(
      "workflow_engine_bindings_step_routine_uidx",
    );
  });

  it("is idempotent for workflows, versions, bindings, and triggers", () => {
    expect(migration0178).toContain("ON CONFLICT (tenant_id, slug)");
    expect(migration0178).toContain(
      "ON CONFLICT (workflow_id, version_number)",
    );
    expect(migration0178).toContain(
      "ON CONFLICT (tenant_id, routine_id) WHERE routine_id IS NOT NULL",
    );
    expect(migration0178).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s+FROM public\.workflow_triggers wt[\s\S]+wt\.trigger_family = 'manual'/,
    );
    expect(migration0178).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s+FROM public\.workflow_triggers wt[\s\S]+wt\.trigger_family = 'schedule'/,
    );
  });

  it("pins current ASL versions for scheduled routine workflows", () => {
    expect(migration0178).toContain("routine_asl_version_id");
    expect(migration0178).toMatch(
      /sj\.trigger_type IN \('routine_schedule', 'routine_one_time'\)/,
    );
    expect(migration0178).toContain("sj.enabled = true");
    expect(migration0178).toMatch(
      /b\.workflow_version_id IS NULL OR b\.routine_asl_version_id IS NULL/,
    );
  });

  it("stamps backfilled rows so rollback can target only this migration", () => {
    expect(migration0178).toContain(
      "'backfillMigration', '0178_workflow_backfill_existing_routines'",
    );
    expect(rollback0178).toContain(
      "b.connection_ref->>'backfillMigration' = '0178_workflow_backfill_existing_routines'",
    );
  });

  it("rollback keeps workflows that already have product run evidence", () => {
    expect(rollback0178).toContain(
      "DROP VIEW IF EXISTS public.view_workflow_backfill_existing_routines_status",
    );
    expect(rollback0178).toMatch(/DELETE FROM public\.workflows w/i);
    expect(rollback0178).toMatch(
      /NOT EXISTS \(\s*SELECT 1\s+FROM public\.workflow_runs wr/i,
    );
    expect(rollback0178).not.toMatch(/DROP TABLE IF EXISTS public\.workflows/i);
  });
});
