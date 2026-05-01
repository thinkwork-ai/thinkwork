/**
 * routine-execution-callback handler — pure shape + validation tests.
 *
 * Drives the exported shapeExecutionCallback function. EventBridge
 * delivery double-fires; idempotency on (execution_arn, status) is
 * enforced by the conditional UPDATE in the handler (only flips status
 * forward; does not regress a terminal status to running).
 */

import { describe, it, expect } from "vitest";
import {
  eventBridgeToBody,
  shapeExecutionCallback,
} from "./routine-execution-callback.js";

const ARN =
  "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-routine:abc-123";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executionArn: ARN,
    status: "succeeded",
    finishedAt: "2026-05-01T12:00:42Z",
    ...overrides,
  };
}

describe("shapeExecutionCallback — required fields", () => {
  it("rejects missing executionArn", () => {
    const r = shapeExecutionCallback({ ...base(), executionArn: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/executionArn/);
  });

  it("rejects empty executionArn", () => {
    const r = shapeExecutionCallback({ ...base(), executionArn: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing status", () => {
    const r = shapeExecutionCallback({ ...base(), status: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/status/);
  });

  it("rejects unknown status", () => {
    const r = shapeExecutionCallback({ ...base(), status: "exploded" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/status/);
  });
});

describe("shapeExecutionCallback — happy paths", () => {
  it("accepts each allowed status", () => {
    for (const status of [
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "awaiting_approval",
      "timed_out",
    ]) {
      const r = shapeExecutionCallback(base({ status }));
      expect(r.ok, `status=${status}`).toBe(true);
    }
  });

  it("accepts terminal event with totalLlmCostUsdCents + finishedAt", () => {
    const r = shapeExecutionCallback(
      base({
        totalLlmCostUsdCents: 234,
        startedAt: "2026-05-01T12:00:00Z",
        finishedAt: "2026-05-01T12:00:42Z",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sfn_execution_arn).toBe(ARN);
      expect(r.value.status).toBe("succeeded");
      expect(r.value.total_llm_cost_usd_cents).toBe(234);
      expect(r.value.started_at?.toISOString()).toBe(
        "2026-05-01T12:00:00.000Z",
      );
      expect(r.value.finished_at?.toISOString()).toBe(
        "2026-05-01T12:00:42.000Z",
      );
    }
  });

  it("accepts running event with no finishedAt", () => {
    const r = shapeExecutionCallback(
      base({ status: "running", finishedAt: undefined }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("running");
      expect(r.value.finished_at).toBeNull();
    }
  });

  it("preserves error_code + error_message on failure", () => {
    const r = shapeExecutionCallback(
      base({
        status: "failed",
        errorCode: "States.TaskFailed",
        errorMessage: "python sandbox returned exit_code=1",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.error_code).toBe("States.TaskFailed");
      expect(r.value.error_message).toBe(
        "python sandbox returned exit_code=1",
      );
    }
  });
});

describe("eventBridgeToBody — SFN-state-change translator", () => {
  it("translates SUCCEEDED into the body shape and lowercases status", () => {
    const body = eventBridgeToBody({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: {
        executionArn: ARN,
        status: "SUCCEEDED",
        startDate: 1714564800000,
        stopDate: 1714564842000,
        output: JSON.stringify({ ok: true }),
      },
    });
    expect(body.executionArn).toBe(ARN);
    expect(body.status).toBe("succeeded");
    expect(body.startedAt).toBe("2024-05-01T12:00:00.000Z");
    expect(body.finishedAt).toBe("2024-05-01T12:00:42.000Z");
    expect(body.outputJson).toEqual({ ok: true });
  });

  it("maps ABORTED to cancelled and TIMED_OUT to timed_out", () => {
    const aborted = eventBridgeToBody({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: { executionArn: ARN, status: "ABORTED" },
    });
    expect(aborted.status).toBe("cancelled");
    const timedOut = eventBridgeToBody({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: { executionArn: ARN, status: "TIMED_OUT" },
    });
    expect(timedOut.status).toBe("timed_out");
  });

  it("preserves error + cause on FAILED", () => {
    const body = eventBridgeToBody({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: {
        executionArn: ARN,
        status: "FAILED",
        error: "States.TaskFailed",
        cause: "python sandbox returned exit_code=1",
      },
    });
    expect(body.status).toBe("failed");
    expect(body.errorCode).toBe("States.TaskFailed");
    expect(body.errorMessage).toBe("python sandbox returned exit_code=1");
  });

  it("falls back to raw output when SFN output isn't JSON", () => {
    const body = eventBridgeToBody({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: {
        executionArn: ARN,
        status: "SUCCEEDED",
        output: "literal-string-not-json",
      },
    });
    expect(body.outputJson).toEqual({ raw: "literal-string-not-json" });
  });
});

describe("shapeExecutionCallback — coercion", () => {
  it("drops non-finite totalLlmCostUsdCents", () => {
    const r = shapeExecutionCallback(
      base({ totalLlmCostUsdCents: Number.NaN }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.total_llm_cost_usd_cents).toBeNull();
  });

  it("coerces ISO timestamps to Date", () => {
    const r = shapeExecutionCallback(
      base({ finishedAt: "2026-05-01T12:00:42Z" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.finished_at).toBeInstanceOf(Date);
  });
});
