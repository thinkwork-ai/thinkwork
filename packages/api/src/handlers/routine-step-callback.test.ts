/**
 * routine-step-callback handler — pure shape + validation tests.
 *
 * Mirrors the sandbox-invocation-log.test.ts pattern: drives the exported
 * shapeStepCallback function with raw bodies and asserts validation
 * outcomes. The DB-side idempotency (ON CONFLICT DO NOTHING on the
 * (execution_id, node_id, status, started_at) unique index) is exercised
 * by the integration test suite, not these unit tests.
 */

import { describe, it, expect } from "vitest";
import { shapeStepCallback } from "./routine-step-callback.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const EXECUTION_ARN =
  "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-routine:abc-123";

function base(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tenantId: TENANT,
    executionArn: EXECUTION_ARN,
    nodeId: "FetchOvernightEmails",
    recipeType: "python",
    status: "succeeded",
    startedAt: "2026-05-01T12:00:00Z",
    finishedAt: "2026-05-01T12:00:42Z",
    ...overrides,
  };
}

describe("shapeStepCallback — required fields", () => {
  it("rejects missing tenantId", () => {
    const r = shapeStepCallback({ ...base(), tenantId: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tenantId/);
  });

  it("rejects non-UUID tenantId", () => {
    const r = shapeStepCallback({ ...base(), tenantId: "not-a-uuid" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing executionArn", () => {
    const r = shapeStepCallback({ ...base(), executionArn: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/executionArn/);
  });

  it("rejects empty executionArn", () => {
    const r = shapeStepCallback({ ...base(), executionArn: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing nodeId", () => {
    const r = shapeStepCallback({ ...base(), nodeId: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nodeId/);
  });

  it("rejects nodeId that path-traverses (e.g. contains slash)", () => {
    const r = shapeStepCallback({ ...base(), nodeId: "some/path" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nodeId/);
  });

  it("rejects unknown recipeType", () => {
    const r = shapeStepCallback({ ...base(), recipeType: "javascript" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recipeType/);
  });

  it("rejects unknown status", () => {
    const r = shapeStepCallback({ ...base(), status: "panicked" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/status/);
  });
});

describe("shapeStepCallback — happy paths", () => {
  it("accepts a fully-populated python success event", () => {
    const r = shapeStepCallback(
      base({
        inputJson: { code: "print('hi')" },
        outputJson: { exitCode: 0 },
        llmCostUsdCents: 12,
        retryCount: 0,
        stdoutS3Uri: "s3://bucket/k.log",
        stderrS3Uri: "s3://bucket/e.log",
        stdoutPreview: "hi\n",
        truncated: false,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tenant_id).toBe(TENANT);
      expect(r.value.execution_arn).toBe(EXECUTION_ARN);
      expect(r.value.node_id).toBe("FetchOvernightEmails");
      expect(r.value.recipe_type).toBe("python");
      expect(r.value.status).toBe("succeeded");
      expect(r.value.started_at?.toISOString()).toBe(
        "2026-05-01T12:00:00.000Z",
      );
      expect(r.value.finished_at?.toISOString()).toBe(
        "2026-05-01T12:00:42.000Z",
      );
      expect(r.value.output_json).toEqual({ exitCode: 0 });
      expect(r.value.llm_cost_usd_cents).toBe(12);
      expect(r.value.retry_count).toBe(0);
      expect(r.value.stdout_s3_uri).toBe("s3://bucket/k.log");
      expect(r.value.truncated).toBe(false);
    }
  });

  it("accepts a running event with no finishedAt", () => {
    const r = shapeStepCallback(
      base({ status: "running", finishedAt: undefined }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("running");
      expect(r.value.finished_at).toBeNull();
    }
  });

  it("accepts each terminal status", () => {
    for (const status of [
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
      "awaiting_approval",
    ]) {
      const r = shapeStepCallback(base({ status }));
      expect(r.ok, `status=${status}`).toBe(true);
    }
  });

  it("accepts each v0 recipe type", () => {
    for (const recipeType of [
      "http_request",
      "aurora_query",
      "transform_json",
      "set_variable",
      "slack_send",
      "email_send",
      "inbox_approval",
      "python",
      "typescript",
      "agent_invoke",
      "tool_invoke",
      "routine_invoke",
      "choice",
      "wait",
      "map",
      "sequence",
      "fail",
    ]) {
      const r = shapeStepCallback(base({ recipeType }));
      expect(r.ok, `recipeType=${recipeType}`).toBe(true);
    }
  });
});

describe("shapeStepCallback — coercion + defaults", () => {
  it("defaults retryCount to 0 when omitted", () => {
    const r = shapeStepCallback(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.retry_count).toBe(0);
  });

  it("coerces truncated from truthy/falsy inputs", () => {
    const a = shapeStepCallback(base({ truncated: 1 }));
    const b = shapeStepCallback(base({ truncated: 0 }));
    expect(a.ok && a.value.truncated).toBe(true);
    expect(b.ok && b.value.truncated).toBe(false);
  });

  it("drops non-finite llmCostUsdCents", () => {
    const r = shapeStepCallback(base({ llmCostUsdCents: Number.NaN }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.llm_cost_usd_cents).toBeNull();
  });

  it("merges out-of-order events without rejecting (finishedAt before startedAt)", () => {
    // Valid input — the dedup happens in the DB layer; the shape function
    // doesn't enforce wall-clock ordering. Exotic but legal under
    // EventBridge late delivery.
    const r = shapeStepCallback(
      base({
        startedAt: "2026-05-01T12:00:42Z",
        finishedAt: "2026-05-01T12:00:00Z",
      }),
    );
    expect(r.ok).toBe(true);
  });
});
