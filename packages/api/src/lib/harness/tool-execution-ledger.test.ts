import { describe, expect, it, vi } from "vitest";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  mergeToolExecutionInvocations,
  projectToolExecutionInvocations,
  type ToolExecutionLedgerStore,
} from "./tool-execution-ledger.js";

const correlation = {
  tenantId: "tenant-1",
  threadId: "thread-1",
  turnId: "turn-1",
  principalType: "user" as const,
  principalId: "user-1",
  toolUseId: "tool-use-1",
  operation: "twenty.opportunity.list",
  policyRevision: "policy-v7",
  idempotencyKey: "idem-1",
};

function store(): ToolExecutionLedgerStore & {
  rows: Array<Record<string, unknown>>;
} {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    append: vi.fn(async (row) => {
      rows.push(row);
      return { id: rows.length };
    }),
  };
}

describe("tool execution ledger", () => {
  it("appends a sanitized start event with the complete correlation key", async () => {
    const target = store();
    await appendToolExecutionStarted(target, {
      ...correlation,
      policyDecisionId: "decision-1",
      credentialOwnerAlias: "owner-hmac-1",
      input: {
        limit: 5,
        authorization: "Bearer must-never-persist",
      },
      inputAllowPaths: ["limit"],
    });

    expect(target.rows).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        principal_type: "user",
        principal_id: "user-1",
        tool_use_id: "tool-use-1",
        operation: "twenty.opportunity.list",
        policy_revision: "policy-v7",
        policy_decision_id: "decision-1",
        idempotency_key: "idem-1",
        credential_owner_alias: "owner-hmac-1",
        event_type: "started",
        input_preview: { limit: 5 },
        output_preview: null,
        error_preview: null,
      }),
    ]);
    expect(JSON.stringify(target.rows)).not.toContain("must-never-persist");
  });

  it.each(["completed", "failed", "uncertain"] as const)(
    "appends a sanitized %s terminal event",
    async (status) => {
      const target = store();
      const canary = "provider-secret-canary";
      await appendToolExecutionTerminal(target, {
        ...correlation,
        status,
        providerRequestId: "request-1",
        durationMs: 123,
        providerCostUsd: "0.00120000",
        output: { count: 5, raw: canary },
        outputAllowPaths: ["count"],
        error: { code: "UPSTREAM", message: `failed ${canary}` },
        errorAllowPaths: ["code", "message"],
        forbiddenValues: [canary],
      });

      expect(target.rows[0]).toEqual(
        expect.objectContaining({
          event_type: status,
          input_preview: null,
          output_preview: { count: 5 },
          error_preview: { code: "UPSTREAM", message: "failed [REDACTED]" },
          provider_request_id: "request-1",
          duration_ms: 123,
          provider_cost_usd: "0.00120000",
        }),
      );
      expect(JSON.stringify(target.rows)).not.toContain(canary);
    },
  );

  it("rejects invalid correlation and terminal measurements before writing", async () => {
    const target = store();
    await expect(
      appendToolExecutionStarted(target, {
        ...correlation,
        idempotencyKey: "",
        input: {},
        inputAllowPaths: [],
      }),
    ).rejects.toThrow(/idempotencyKey/);
    await expect(
      appendToolExecutionTerminal(target, {
        ...correlation,
        status: "completed",
        durationMs: -1,
        output: {},
        outputAllowPaths: [],
      }),
    ).rejects.toThrow(/durationMs/);
    expect(target.rows).toHaveLength(0);
  });

  it("projects redacted start and terminal evidence into turn-detail invocations", () => {
    const rows = [
      {
        idempotency_key: "idem-list",
        tool_use_id: "tool-list",
        operation: "mcp.tools.list",
        policy_revision: "policy-v7",
        policy_decision_id: "decision-1",
        credential_owner_alias: "owner-hmac-1",
        event_type: "started" as const,
        input_preview: { connector: "twenty--crm" },
        output_preview: null,
        error_preview: null,
        provider_request_id: null,
        duration_ms: null,
        provider_cost_usd: null,
      },
      {
        idempotency_key: "idem-list",
        tool_use_id: "tool-list",
        operation: "mcp.tools.list",
        policy_revision: "policy-v7",
        policy_decision_id: "decision-1",
        credential_owner_alias: "owner-hmac-1",
        event_type: "completed" as const,
        input_preview: null,
        output_preview: { connector: "twenty--crm", toolCount: 3 },
        error_preview: null,
        provider_request_id: "request-1",
        duration_ms: 6816,
        provider_cost_usd: "0.00120000",
      },
    ];

    expect(projectToolExecutionInvocations(rows)).toEqual([
      expect.objectContaining({
        tool_name: "mcp_twenty--crm_list_tools",
        status: "completed",
        duration_ms: 6816,
        cost_usd: 0.0012,
        input_preview: '{"connector":"twenty--crm"}',
        output_preview: '{"connector":"twenty--crm","toolCount":3}',
        evidence_source: "harness_tool_execution_events",
      }),
    ]);
  });

  it("deduplicates streamed and governed evidence by tool use id while preferring the ledger", () => {
    expect(
      mergeToolExecutionInvocations(
        [
          {
            tool_name: "browser",
            tool_use_id: "browser-1",
            status: "completed",
            protocol: "agentcore_harness_internal_v1",
          },
          {
            tool_name: "memory_search",
            tool_use_id: "memory-1",
            status: "completed",
          },
        ],
        [
          {
            tool_name: "browser",
            tool_use_id: "browser-1",
            status: "completed",
            policy_revision: "policy-v8",
            evidence_source: "harness_tool_execution_events",
          },
        ],
      ),
    ).toEqual([
      {
        tool_name: "browser",
        tool_use_id: "browser-1",
        status: "completed",
        protocol: "agentcore_harness_internal_v1",
        policy_revision: "policy-v8",
        evidence_source: "harness_tool_execution_events",
      },
      {
        tool_name: "memory_search",
        tool_use_id: "memory-1",
        status: "completed",
      },
    ]);
  });
});
