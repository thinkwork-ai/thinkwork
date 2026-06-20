import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0177 = readFileSync(
  join(HERE, "..", "drizzle", "0177_workflow_control_plane.sql"),
  "utf-8",
);
const rollback0177 = readFileSync(
  join(HERE, "..", "drizzle", "0177_workflow_control_plane_rollback.sql"),
  "utf-8",
);

describe("migration 0177 - workflow control plane", () => {
  it("declares drift markers for workflow tables and indexes", () => {
    for (const marker of [
      "public.workflows",
      "public.workflow_versions",
      "public.workflow_triggers",
      "public.workflow_engine_bindings",
      "public.workflow_runs",
      "public.workflow_run_events",
      "public.workflow_evidence",
      "public.workflows_tenant_slug_uidx",
      "public.workflow_versions_workflow_version_uidx",
      "public.workflow_engine_bindings_step_routine_uidx",
      "public.workflow_engine_bindings_external_uidx",
      "public.workflow_runs_tenant_idempotency_uidx",
      "public.workflow_evidence_source_idx",
    ]) {
      expect(migration0177).toContain(`-- creates: ${marker}`);
    }
  });

  it("declares drift markers for DB-level check constraints", () => {
    for (const marker of [
      "public.workflows.workflows_lifecycle_status_check",
      "public.workflows.workflows_visibility_check",
      "public.workflows.workflows_trigger_family_check",
      "public.workflows.workflows_readiness_state_check",
      "public.workflow_versions.workflow_versions_status_check",
      "public.workflow_triggers.workflow_triggers_family_check",
      "public.workflow_engine_bindings.workflow_engine_bindings_type_check",
      "public.workflow_engine_bindings.workflow_engine_bindings_status_check",
      "public.workflow_runs.workflow_runs_status_check",
      "public.workflow_run_events.workflow_run_events_provenance_check",
      "public.workflow_evidence.workflow_evidence_redaction_state_check",
    ]) {
      expect(migration0177).toContain(`-- creates-constraint: ${marker}`);
    }
  });

  it("uses idempotent additive DDL and compatibility references", () => {
    expect(migration0177).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.workflows/i,
    );
    expect(migration0177).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.workflow_engine_bindings/i,
    );
    expect(migration0177).toMatch(
      /routine_id uuid REFERENCES public\.routines\(id\) ON DELETE SET NULL/i,
    );
    expect(migration0177).toMatch(
      /routine_asl_version_id uuid REFERENCES public\.routine_asl_versions\(id\) ON DELETE SET NULL/i,
    );
    expect(migration0177).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS workflow_engine_bindings_step_routine_uidx",
    );
    expect(migration0177).toContain("WHERE routine_id IS NOT NULL");
    expect(migration0177).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });

  it("rolls back dependent tables before workflow identity", () => {
    const evidenceDrop = rollback0177.indexOf(
      "DROP TABLE IF EXISTS public.workflow_evidence",
    );
    const eventsDrop = rollback0177.indexOf(
      "DROP TABLE IF EXISTS public.workflow_run_events",
    );
    const runsDrop = rollback0177.indexOf(
      "DROP TABLE IF EXISTS public.workflow_runs",
    );
    const workflowsDrop = rollback0177.indexOf(
      "DROP TABLE IF EXISTS public.workflows",
    );

    expect(evidenceDrop).toBeGreaterThanOrEqual(0);
    expect(eventsDrop).toBeGreaterThanOrEqual(0);
    expect(runsDrop).toBeGreaterThanOrEqual(0);
    expect(workflowsDrop).toBeGreaterThanOrEqual(0);
    expect(evidenceDrop).toBeLessThan(eventsDrop);
    expect(eventsDrop).toBeLessThan(runsDrop);
    expect(runsDrop).toBeLessThan(workflowsDrop);
  });
});
