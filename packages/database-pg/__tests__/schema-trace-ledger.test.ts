import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  costEvents,
  traceCostReconciliationFacts,
  traceEvents,
  traceRuns,
  traceSourceEvidence,
} from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0189 = readFileSync(
  join(HERE, "..", "drizzle", "0189_trace_cost_substrate.sql"),
  "utf-8",
);

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("trace cost substrate schema", () => {
  it("defines canonical trace run identity", () => {
    expect(columnNames(traceRuns)).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "trace_id",
        "thread_id",
        "thread_turn_id",
        "agent_id",
        "user_id",
        "runtime_session_id",
      ]),
    );
    expect(migration0189).toContain("-- creates: public.trace_runs");
    expect(migration0189).toContain("trace_runs_tenant_trace_uidx");
  });

  it("defines parent-child trace events with safe summaries", () => {
    expect(columnNames(traceEvents)).toEqual(
      expect.arrayContaining([
        "trace_run_id",
        "parent_event_id",
        "request_id",
        "parent_request_id",
        "event_type",
        "payload_summary",
        "source_evidence_ref",
        "metadata",
      ]),
    );
    expect(migration0189).toContain("-- creates: public.trace_events");
    expect(migration0189).toContain("trace_events_type_check");
  });

  it("defines source evidence references without requiring raw payload storage", () => {
    expect(columnNames(traceSourceEvidence)).toEqual(
      expect.arrayContaining([
        "source_type",
        "source_system",
        "source_id",
        "uri",
        "summary",
        "redaction_state",
        "retention_expires_at",
      ]),
    );
    expect(migration0189).toContain("-- creates: public.trace_source_evidence");
    expect(migration0189).toContain("trace_source_evidence_source_type_check");
  });

  it("defines append-only reconciliation facts for runtime, invocation, and bill evidence", () => {
    expect(columnNames(traceCostReconciliationFacts)).toEqual(
      expect.arrayContaining([
        "cost_event_id",
        "source_evidence_id",
        "reconciliation_state",
        "reconciliation_scope",
        "runtime_input_tokens",
        "provider_input_tokens",
        "billed_amount_usd",
        "variance_usd",
        "attribution_level",
      ]),
    );
    expect(migration0189).toContain(
      "-- creates: public.trace_cost_reconciliation_facts",
    );
    expect(migration0189).toContain("trace_cost_recon_facts_state_check");
  });

  it("adds cost event compatibility fields for current projections", () => {
    const columns = getTableConfig(costEvents).columns;
    const reconciliationState = columns.find(
      (column) => column.name === "reconciliation_state",
    );

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "trace_event_id",
        "reconciliation_state",
        "reconciliation_source",
        "reconciliation_at",
        "source_evidence_ref",
      ]),
    );
    expect(reconciliationState?.notNull).toBe(true);
    expect(reconciliationState?.hasDefault).toBe(true);
    expect(migration0189).toContain(
      "-- creates-column: public.cost_events.reconciliation_state",
    );
    expect(migration0189).toContain("cost_events_reconciliation_state_check");
  });
});
