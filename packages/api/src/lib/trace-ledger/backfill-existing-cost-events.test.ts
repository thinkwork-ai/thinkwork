import { describe, expect, it } from "vitest";
import {
  buildHistoricalCostEventBackfillPlan,
  buildHistoricalThreadTurnUsageBackfillPlan,
} from "./backfill-existing-cost-events.js";

describe("buildHistoricalCostEventBackfillPlan", () => {
  it("marks historical cost-only rows as unreconciled backfill evidence without false provider/bill upgrade", () => {
    const plan = buildHistoricalCostEventBackfillPlan({
      id: "cost-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      user_id: "user-1",
      thread_id: "thread-1",
      request_id: "turn-1",
      event_type: "llm",
      runtime_type: "pi",
      amount_usd: "0.012345",
      model: "anthropic.claude-haiku",
      provider: "bedrock",
      input_tokens: 120,
      output_tokens: 40,
      cached_read_tokens: 10,
      duration_ms: 900,
      reconciliation_state: "runtime-reported",
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(plan.traceId).toBe("backfill:cost-event:cost-1");
    expect(plan.event).toMatchObject({
      event_type: "model_invocation",
      event_status: "historical",
      payload_summary: {
        model: "anthropic.claude-haiku",
        provider: "bedrock",
        input_tokens: 120,
        output_tokens: 40,
        cached_read_tokens: 10,
        amount_usd: "0.012345",
        historical_observation: true,
        prior_reconciliation_state: "runtime-reported",
      },
      metadata: {
        source: "historical_cost_event_backfill",
        backfill_reason: "pre_trace_ledger_cost_event",
      },
    });
    expect(plan.sourceEvidence).toMatchObject({
      source_type: "backfill",
      source_system: "thinkwork.cost_events",
      source_id: "cost-1",
      redaction_state: "summary_only",
    });
    expect(plan.reconciliationFact).toMatchObject({
      cost_event_id: "cost-1",
      reconciliation_state: "unreconciled/error",
      reconciliation_scope: "runtime",
      provider: "bedrock",
      model: "anthropic.claude-haiku",
      runtime_input_tokens: 120,
      runtime_output_tokens: 40,
      runtime_cached_read_tokens: 10,
      runtime_amount_usd: "0.012345",
      metadata: {
        source: "historical_cost_event_backfill",
        reason:
          "Historical cost row predates provider/billing evidence capture; no provider or bill reconciliation is inferred.",
      },
    });
    expect(plan.costEventUpdate).toMatchObject({
      costEventId: "cost-1",
      reconciliation_state: "unreconciled/error",
      reconciliation_source: "backfill",
      source_evidence_ref: {
        source_type: "backfill",
        source_system: "thinkwork.cost_events",
        source_id: "cost-1",
      },
    });
  });

  it("keeps an existing trace id but still refuses to infer reconciliation", () => {
    const plan = buildHistoricalCostEventBackfillPlan({
      id: "cost-2",
      tenant_id: "tenant-1",
      request_id: "request-2",
      event_type: "agentcore_compute",
      amount_usd: 0.01,
      trace_id: "runtime-trace-2",
      reconciliation_state: "runtime-reported",
    });

    expect(plan.traceId).toBe("runtime-trace-2");
    expect(plan.event.event_type).toBe("runtime_phase");
    expect(plan.reconciliationFact.reconciliation_state).toBe(
      "unreconciled/error",
    );
  });
});

describe("buildHistoricalThreadTurnUsageBackfillPlan", () => {
  it("creates a cost-observation event from usage_json without provider or bill evidence", () => {
    const plan = buildHistoricalThreadTurnUsageBackfillPlan({
      id: "turn-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      thread_id: "thread-1",
      runtime_type: "pi",
      status: "succeeded",
      usage_json: {
        model: "anthropic.claude-haiku",
        input_tokens: 50,
        output_tokens: 10,
        cached_read_tokens: 5,
        cost_usd: 0.004,
        raw_prompt: "not copied into summary",
      },
      started_at: "2026-06-01T00:00:00.000Z",
      finished_at: "2026-06-01T00:01:00.000Z",
    });

    expect(plan).toMatchObject({
      traceId: "backfill:thread-turn:turn-1",
      event: {
        request_id: "turn-1",
        event_type: "cost_observation",
        event_status: "historical",
        payload_summary: {
          model: "anthropic.claude-haiku",
          runtime_type: "pi",
          input_tokens: 50,
          output_tokens: 10,
          cached_read_tokens: 5,
          amount_usd: 0.004,
          historical_observation: true,
        },
      },
      reconciliationFact: {
        reconciliation_state: "unreconciled/error",
        reconciliation_scope: "runtime",
        model: "anthropic.claude-haiku",
        request_id: "turn-1",
        attribution_level: "historical_thread_turn_usage",
        runtime_input_tokens: 50,
        runtime_output_tokens: 10,
        runtime_cached_read_tokens: 5,
        runtime_amount_usd: "0.004",
      },
    });
    expect(JSON.stringify(plan)).not.toContain("not copied into summary");
  });

  it("returns null when usage_json has no usage-like fields", () => {
    expect(
      buildHistoricalThreadTurnUsageBackfillPlan({
        id: "turn-empty",
        tenant_id: "tenant-1",
        usage_json: { workspace_diagnostics: { ok: true } },
      }),
    ).toBeNull();
  });
});
