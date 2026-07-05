import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema";
import {
  AGENT_LOOP_LIFECYCLE_STATUSES,
  AGENT_LOOP_RUN_STATUSES,
  AGENT_LOOP_TRIGGER_FAMILIES,
  AGENT_LOOP_VERSION_STATUSES,
  agentLoopIterations,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
} from "../src/schema/agent-loops";
import { scheduledJobs } from "../src/schema/scheduled-jobs";

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

describe("agent loop schema", () => {
  it("exports AgentLoop tables and vocabularies from the schema barrel", () => {
    expect(schema.agentLoops).toBe(agentLoops);
    expect(schema.agentLoopVersions).toBe(agentLoopVersions);
    expect(schema.agentLoopRuns).toBe(agentLoopRuns);
    expect(schema.agentLoopIterations).toBe(agentLoopIterations);

    expect(schema.AGENT_LOOP_LIFECYCLE_STATUSES).toBe(
      AGENT_LOOP_LIFECYCLE_STATUSES,
    );
    expect(schema.AGENT_LOOP_VERSION_STATUSES).toBe(
      AGENT_LOOP_VERSION_STATUSES,
    );
    expect(schema.AGENT_LOOP_TRIGGER_FAMILIES).toBe(
      AGENT_LOOP_TRIGGER_FAMILIES,
    );
    expect(schema.AGENT_LOOP_RUN_STATUSES).toBe(AGENT_LOOP_RUN_STATUSES);
  });

  it("models AgentLoop identity as a first-class product object", () => {
    expect(getTableName(agentLoops)).toBe("agent_loops");
    const columns = getTableColumns(agentLoops);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.name.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.lifecycle_status.default).toBe("draft");
    expect(columns.enabled.default).toBe(true);
    expect(columns.primary_trigger_family.default).toBe("manual");
    expect(columns.current_version_id.notNull).toBe(false);
    expect(columns.last_run_summary.notNull).toBe(true);

    expect(indexNames(agentLoops)).toEqual(
      expect.arrayContaining([
        "agent_loops_tenant_slug_uidx",
        "agent_loops_tenant_lifecycle_idx",
        "agent_loops_tenant_enabled_idx",
        "agent_loops_tenant_last_run_idx",
      ]),
    );
    expect(checkNames(agentLoops)).toEqual(
      expect.arrayContaining([
        "agent_loops_lifecycle_status_check",
        "agent_loops_trigger_family_check",
      ]),
    );
  });

  it("stores versioned specs and run ledger snapshots", () => {
    expect(getTableName(agentLoopVersions)).toBe("agent_loop_versions");
    const versionColumns = getTableColumns(agentLoopVersions);
    expect(versionColumns.agent_loop_id.notNull).toBe(true);
    expect(versionColumns.version_number.notNull).toBe(true);
    expect(versionColumns.trigger_spec.notNull).toBe(true);
    expect(versionColumns.goal_spec.notNull).toBe(true);
    expect(versionColumns.worker_spec.notNull).toBe(true);
    expect(versionColumns.loop_policy.notNull).toBe(true);
    expect(indexNames(agentLoopVersions)).toEqual(
      expect.arrayContaining([
        "agent_loop_versions_loop_version_uidx",
        "agent_loop_versions_tenant_loop_idx",
      ]),
    );

    expect(getTableName(agentLoopRuns)).toBe("agent_loop_runs");
    const runColumns = getTableColumns(agentLoopRuns);
    expect(runColumns.agent_loop_id.notNull).toBe(true);
    expect(runColumns.agent_loop_version_id.notNull).toBe(false);
    expect(runColumns.status.default).toBe("queued");
    expect(runColumns.trigger_family.notNull).toBe(true);
    expect(runColumns.scheduled_job_id.notNull).toBe(false);
    expect(runColumns.idempotency_key.notNull).toBe(false);
    expect(runColumns.current_iteration.notNull).toBe(true);
    expect(runColumns.total_cost_usd_cents.notNull).toBe(false);
    expect(indexNames(agentLoopRuns)).toEqual(
      expect.arrayContaining([
        "agent_loop_runs_tenant_status_idx",
        "agent_loop_runs_loop_created_idx",
        "agent_loop_runs_tenant_idempotency_uidx",
      ]),
    );
  });

  it("stores iterations without workflow_runs", () => {
    expect(getTableName(agentLoopIterations)).toBe("agent_loop_iterations");
    const iterationColumns = getTableColumns(agentLoopIterations);
    expect(iterationColumns.agent_loop_run_id.notNull).toBe(true);
    expect(iterationColumns.iteration_number.notNull).toBe(true);
    expect(iterationColumns.agent_wakeup_request_id.notNull).toBe(false);
    expect(iterationColumns.thread_turn_id.notNull).toBe(false);
    expect(indexNames(agentLoopIterations)).toContain(
      "agent_loop_iterations_run_number_uidx",
    );
  });

  it("no longer defines judge/evidence/ROI schema (THINK-137 U10 PR B)", () => {
    // Judge tables, evidence tables, and the agent_loops ROI counters were
    // dropped in migration 0214. Guard against reintroduction.
    expect("agentLoopJudgments" in schema).toBe(false);
    expect("agentLoopEvidence" in schema).toBe(false);

    const loopColumns = getTableColumns(agentLoops);
    expect("accepted_run_count" in loopColumns).toBe(false);
    expect("rejected_run_count" in loopColumns).toBe(false);
    expect("escalated_run_count" in loopColumns).toBe(false);
    expect("total_cost_usd_cents" in loopColumns).toBe(false);
    expect("cost_per_accepted_run_usd_cents" in loopColumns).toBe(false);

    const versionColumns = getTableColumns(agentLoopVersions);
    expect("judge_spec" in versionColumns).toBe(false);
    expect("evidence_policy" in versionColumns).toBe(false);
  });

  it("binds scheduled_jobs to AgentLoop without making scheduled_jobs the product table", () => {
    const scheduledColumns = getTableColumns(scheduledJobs);
    expect(scheduledColumns.agent_loop_id.notNull).toBe(false);
    expect(indexNames(scheduledJobs)).toContain(
      "idx_scheduled_jobs_agent_loop",
    );
  });
});
