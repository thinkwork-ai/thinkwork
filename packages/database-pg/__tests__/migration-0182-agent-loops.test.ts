import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0182 = readFileSync(
  join(HERE, "..", "drizzle", "0182_agent_loops.sql"),
  "utf-8",
);

describe("migration 0182 - agent loops", () => {
  it("declares drift markers for AgentLoop tables, indexes, and schedule binding", () => {
    for (const marker of [
      "public.agent_loops",
      "public.agent_loop_versions",
      "public.agent_loop_runs",
      "public.agent_loop_iterations",
      "public.agent_loop_judgments",
      "public.agent_loop_evidence",
      "public.agent_loops_tenant_slug_uidx",
      "public.agent_loop_versions_loop_version_uidx",
      "public.agent_loop_runs_tenant_idempotency_uidx",
      "public.agent_loop_iterations_run_number_uidx",
      "public.agent_loop_evidence_source_idx",
      "public.idx_scheduled_jobs_agent_loop",
    ]) {
      expect(migration0182).toContain(`-- creates: ${marker}`);
    }
    expect(migration0182).toContain(
      "-- creates-column: public.scheduled_jobs.agent_loop_id",
    );
  });

  it("declares DB-level checks for loop statuses, trigger families, and judgment vocabularies", () => {
    for (const marker of [
      "public.agent_loops.agent_loops_lifecycle_status_check",
      "public.agent_loops.agent_loops_trigger_family_check",
      "public.agent_loop_versions.agent_loop_versions_status_check",
      "public.agent_loop_runs.agent_loop_runs_status_check",
      "public.agent_loop_runs.agent_loop_runs_trigger_family_check",
      "public.agent_loop_iterations.agent_loop_iterations_status_check",
      "public.agent_loop_judgments.agent_loop_judgments_mode_check",
      "public.agent_loop_judgments.agent_loop_judgments_outcome_check",
      "public.agent_loop_evidence.agent_loop_evidence_redaction_state_check",
    ]) {
      expect(migration0182).toContain(`-- creates-constraint: ${marker}`);
    }
  });

  it("uses additive idempotent DDL and preserves legacy scheduled jobs", () => {
    for (const relation of [
      "public.tenants",
      "public.users",
      "public.agents",
      "public.scheduled_jobs",
    ]) {
      expect(migration0182).toContain(`to_regclass('${relation}')`);
    }

    expect(migration0182).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.agent_loops/i,
    );
    expect(migration0182).toMatch(
      /ALTER TABLE public\.scheduled_jobs\s+ADD COLUMN IF NOT EXISTS agent_loop_id uuid/i,
    );
    expect(migration0182).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  });
});
