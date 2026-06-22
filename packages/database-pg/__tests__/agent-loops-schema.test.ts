import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema";
import {
  AGENT_LOOP_EVIDENCE_REDACTION_STATES,
  AGENT_LOOP_JUDGE_MODES,
  AGENT_LOOP_JUDGMENT_OUTCOMES,
  AGENT_LOOP_LIFECYCLE_STATUSES,
  AGENT_LOOP_RUN_STATUSES,
  AGENT_LOOP_TRIGGER_FAMILIES,
  AGENT_LOOP_VERSION_STATUSES,
  agentLoopEvidence,
  agentLoopIterations,
  agentLoopJudgments,
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
    expect(schema.agentLoopJudgments).toBe(agentLoopJudgments);
    expect(schema.agentLoopEvidence).toBe(agentLoopEvidence);

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
    expect(schema.AGENT_LOOP_JUDGE_MODES).toBe(AGENT_LOOP_JUDGE_MODES);
    expect(schema.AGENT_LOOP_JUDGMENT_OUTCOMES).toBe(
      AGENT_LOOP_JUDGMENT_OUTCOMES,
    );
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
    expect(columns.accepted_run_count.default).toBe(0);
    expect(columns.rejected_run_count.default).toBe(0);

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
    expect(versionColumns.judge_spec.notNull).toBe(true);
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

  it("stores iterations, judgments, and redacted evidence without workflow_runs", () => {
    expect(getTableName(agentLoopIterations)).toBe("agent_loop_iterations");
    const iterationColumns = getTableColumns(agentLoopIterations);
    expect(iterationColumns.agent_loop_run_id.notNull).toBe(true);
    expect(iterationColumns.iteration_number.notNull).toBe(true);
    expect(iterationColumns.agent_wakeup_request_id.notNull).toBe(false);
    expect(iterationColumns.thread_turn_id.notNull).toBe(false);
    expect(indexNames(agentLoopIterations)).toContain(
      "agent_loop_iterations_run_number_uidx",
    );

    expect(getTableName(agentLoopJudgments)).toBe("agent_loop_judgments");
    const judgmentColumns = getTableColumns(agentLoopJudgments);
    expect(judgmentColumns.agent_loop_run_id.notNull).toBe(true);
    expect(judgmentColumns.agent_loop_iteration_id.notNull).toBe(false);
    expect(judgmentColumns.judge_mode.notNull).toBe(true);
    expect(judgmentColumns.outcome.notNull).toBe(true);
    expect(judgmentColumns.structured_output.notNull).toBe(true);

    expect(getTableName(agentLoopEvidence)).toBe("agent_loop_evidence");
    const evidenceColumns = getTableColumns(agentLoopEvidence);
    expect(evidenceColumns.agent_loop_id.notNull).toBe(true);
    expect(evidenceColumns.agent_loop_run_id.notNull).toBe(false);
    expect(evidenceColumns.redaction_state.default).toBe("summary_only");
    expect(indexNames(agentLoopEvidence)).toEqual(
      expect.arrayContaining([
        "agent_loop_evidence_run_idx",
        "agent_loop_evidence_loop_idx",
        "agent_loop_evidence_source_idx",
      ]),
    );
  });

  it("binds scheduled_jobs to AgentLoop without making scheduled_jobs the product table", () => {
    const scheduledColumns = getTableColumns(scheduledJobs);
    expect(scheduledColumns.agent_loop_id.notNull).toBe(false);
    expect(indexNames(scheduledJobs)).toContain(
      "idx_scheduled_jobs_agent_loop",
    );
  });
});
