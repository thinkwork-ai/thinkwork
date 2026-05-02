import { describe, expect, it } from "vitest";
import { eventBridgeToSystemWorkflowUpdate } from "./system-workflow-execution-callback.js";

describe("system-workflow-execution-callback", () => {
  it("translates EventBridge Step Functions events into run updates", () => {
    const shaped = eventBridgeToSystemWorkflowUpdate({
      source: "aws.states",
      "detail-type": "Step Functions Execution Status Change",
      detail: {
        executionArn: "arn:exec",
        status: "SUCCEEDED",
        startDate: Date.parse("2026-05-02T12:00:00Z"),
        stopDate: Date.parse("2026-05-02T12:01:00Z"),
        output: '{"ok":true}',
      },
    });

    expect(shaped).toMatchObject({
      ok: true,
      value: {
        executionArn: "arn:exec",
        status: "succeeded",
        outputJson: { ok: true },
      },
    });
  });

  it("rejects unsupported statuses", () => {
    expect(
      eventBridgeToSystemWorkflowUpdate({
        source: "aws.states",
        "detail-type": "Step Functions Execution Status Change",
        detail: {
          executionArn: "arn:exec",
          status: "UNKNOWN",
        },
      }),
    ).toEqual({ ok: false, error: "Unsupported status UNKNOWN" });
  });
});
