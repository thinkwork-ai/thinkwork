import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  N8N_AGENT_STEP_RESUME_STATUSES,
  N8N_AGENT_STEP_RUN_STATUSES,
  n8nAgentStepRuns,
} from "../src/schema/n8n-agent-step-runs";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0176 = readFileSync(
  join(HERE, "..", "drizzle", "0176_n8n_agent_step_runs.sql"),
  "utf-8",
);

describe("migration 0176 - n8n agent-step run ledger", () => {
  it("exports the ledger table and bridge status vocabularies", () => {
    expect(schema.n8nAgentStepRuns).toBe(n8nAgentStepRuns);
    expect(schema.N8N_AGENT_STEP_RUN_STATUSES).toBe(
      N8N_AGENT_STEP_RUN_STATUSES,
    );
    expect(schema.N8N_AGENT_STEP_RESUME_STATUSES).toBe(
      N8N_AGENT_STEP_RESUME_STATUSES,
    );
    expect(N8N_AGENT_STEP_RUN_STATUSES).toEqual([
      "accepted",
      "waiting",
      "awaiting_human",
      "resume_pending",
      "resuming",
      "resumed",
      "resume_failed",
      "failed",
      "expired",
    ]);
  });

  it("models idempotency, thread linkage, timeout, and resume evidence", () => {
    expect(getTableName(n8nAgentStepRuns)).toBe("n8n_agent_step_runs");
    const columns = getTableColumns(n8nAgentStepRuns);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.space_id.notNull).toBe(true);
    expect(columns.workflow_id.notNull).toBe(true);
    expect(columns.execution_id.notNull).toBe(true);
    expect(columns.step_id.notNull).toBe(true);
    expect(columns.correlation_id.notNull).toBe(true);
    expect(columns.idempotency_key.notNull).toBe(true);
    expect(columns.status.default).toBe("accepted");
    expect(columns.resume_status.default).toBe("not_ready");
    expect(columns.resume_url_secret_ref.notNull).toBe(false);
    expect(columns.timeout_seconds.notNull).toBe(true);
    expect(columns.expires_at.notNull).toBe(true);
    expect(columns.resume_attempt_count.default).toBe(0);
    expect(columns.terminal_at.notNull).toBe(false);

    const indexes = getTableConfig(n8nAgentStepRuns).indexes.map(
      (index) => index.config.name,
    );
    expect(indexes).toContain("n8n_agent_step_runs_tenant_idempotency_uidx");
    expect(indexes).toContain("n8n_agent_step_runs_due_expiry_idx");
    expect(indexes).toContain("n8n_agent_step_runs_resume_pending_idx");
  });

  it("declares manual migration markers, checks, and partial indexes", () => {
    for (const marker of [
      "public.n8n_agent_step_runs",
      "public.n8n_agent_step_runs_tenant_idempotency_uidx",
      "public.n8n_agent_step_runs_tenant_status_idx",
      "public.n8n_agent_step_runs_thread_idx",
      "public.n8n_agent_step_runs_n8n_execution_idx",
      "public.n8n_agent_step_runs_due_expiry_idx",
      "public.n8n_agent_step_runs_resume_pending_idx",
    ]) {
      expect(migration0176).toContain(`-- creates: ${marker}`);
    }
    for (const marker of [
      "public.n8n_agent_step_runs.n8n_agent_step_runs_status_check",
      "public.n8n_agent_step_runs.n8n_agent_step_runs_resume_status_check",
      "public.n8n_agent_step_runs.n8n_agent_step_runs_timeout_bounds_check",
      "public.n8n_agent_step_runs.n8n_agent_step_runs_terminal_state_check",
    ]) {
      expect(migration0176).toContain(`-- creates-constraint: ${marker}`);
    }
    expect(migration0176).toContain(
      "WHERE \"status\" IN ('accepted', 'waiting', 'awaiting_human')",
    );
    expect(migration0176).toContain("WHERE \"status\" = 'resume_pending'");
    expect(migration0176).toContain(
      'CHECK ("timeout_seconds" BETWEEN 300 AND 604800)',
    );
    expect(migration0176).not.toContain("resume_url text");
  });
});
