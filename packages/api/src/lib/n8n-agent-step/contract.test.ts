import { describe, expect, it } from "vitest";
import {
  N8N_AGENT_STEP_TIMEOUT_DEFAULT_SECONDS,
  N8nAgentStepContractError,
  buildN8nAgentStepIdempotencyKey,
  normalizeN8nAgentStepTimeout,
  previewN8nAgentStepValue,
  sanitizeN8nAgentStepMetadata,
} from "./types.js";

describe("n8n agent-step bridge contract", () => {
  it("derives a stable tenant-scoped idempotency key for duplicate starts", () => {
    const base = {
      tenantId: "tenant-1",
      correlationId: "lead-42",
      n8n: {
        workflowId: "wf-123",
        executionId: "exec-456",
        stepId: "classify-lead",
        workflowName: "Inbound lead routing",
      },
    };

    expect(buildN8nAgentStepIdempotencyKey(base)).toBe(
      buildN8nAgentStepIdempotencyKey({
        ...base,
        n8n: { ...base.n8n, workflowName: "Renamed workflow" },
      }),
    );
    expect(buildN8nAgentStepIdempotencyKey(base)).not.toBe(
      buildN8nAgentStepIdempotencyKey({
        ...base,
        correlationId: "lead-43",
      }),
    );
  });

  it("applies the 24-hour default timeout when no override is provided", () => {
    const now = new Date("2026-06-20T20:00:00.000Z");

    expect(normalizeN8nAgentStepTimeout({ now })).toEqual({
      timeoutSeconds: N8N_AGENT_STEP_TIMEOUT_DEFAULT_SECONDS,
      expiresAt: new Date("2026-06-21T20:00:00.000Z"),
    });
  });

  it("rejects timeout overrides below five minutes or above seven days", () => {
    for (const timeoutSeconds of [299, 604801]) {
      try {
        normalizeN8nAgentStepTimeout({ timeoutSeconds });
        throw new Error("Expected timeout validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(N8nAgentStepContractError);
        expect(error).toMatchObject({
          code: "N8N_AGENT_STEP_TIMEOUT_OUT_OF_RANGE",
          field: "timeoutSeconds",
        });
      }
    }
  });

  it("redacts secret-looking metadata while preserving n8n identity fields", () => {
    expect(
      sanitizeN8nAgentStepMetadata({
        workflowId: "wf-123",
        executionId: "exec-456",
        correlationId: "lead-42",
        headers: {
          authorization: "Bearer super-secret-token",
          "x-n8n-execution": "exec-456",
        },
        resumeUrl: "https://n8n.example.com/webhook-waiting/abc",
        workflowName: "Inbound webhook enrichment",
        nested: [{ apiKey: "sk-proj-thisshouldnotleakthisshouldnotleakthis" }],
      }),
    ).toEqual({
      workflowId: "wf-123",
      executionId: "exec-456",
      correlationId: "lead-42",
      headers: {
        authorization: "[redacted]",
        "x-n8n-execution": "exec-456",
      },
      resumeUrl: "[redacted]",
      workflowName: "Inbound webhook enrichment",
      nested: [{ apiKey: "[redacted]" }],
    });
  });

  it("produces bounded previews for structured input", () => {
    const preview = previewN8nAgentStepValue({
      lead: "x".repeat(3000),
    });

    expect(preview.length).toBeLessThanOrEqual(2048);
    expect(preview.endsWith("...[truncated]")).toBe(true);
  });
});
