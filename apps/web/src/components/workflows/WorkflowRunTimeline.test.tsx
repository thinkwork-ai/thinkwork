import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  foldTimeline,
  WorkflowRunTimeline,
  type WorkflowTimelineEvent,
} from "./WorkflowRunTimeline";

afterEach(cleanup);

let seq = 0;
function ev(
  eventType: string,
  payloadSummary: Record<string, unknown>,
  occurredAt: string,
  extra: Partial<WorkflowTimelineEvent> = {},
): WorkflowTimelineEvent {
  seq += 1;
  return {
    id: `event-${seq}`,
    eventType,
    occurredAt,
    payloadSummary,
    ...extra,
  };
}

describe("foldTimeline", () => {
  it("folds two iterations into two groups with per-step statuses", () => {
    const events: WorkflowTimelineEvent[] = [
      ev(
        "workflow_step_started",
        { stepId: "gather", stepKind: "agent", iteration: 0 },
        "2026-06-20T12:00:00.000Z",
      ),
      ev(
        "workflow_step_finished",
        { stepId: "gather", iteration: 0, status: "completed" },
        "2026-06-20T12:00:05.000Z",
      ),
      ev(
        "workflow_step_started",
        { stepId: "gather", stepKind: "agent", iteration: 1 },
        "2026-06-20T12:01:00.000Z",
      ),
      ev(
        "workflow_step_failed",
        { stepId: "gather", iteration: 1, errorSummary: "boom" },
        "2026-06-20T12:01:05.000Z",
      ),
    ];

    const groups = foldTimeline(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].iteration).toBe(0);
    expect(groups[0].steps[0].status).toBe("completed");
    expect(groups[1].iteration).toBe(1);
    expect(groups[1].steps[0].status).toBe("failed");
    expect(groups[1].steps[0].errorSummary).toBe("boom");
  });

  it("collapses the finalize + interpreter duplicate step_finished, keeping the evidence-bearing row", () => {
    const events: WorkflowTimelineEvent[] = [
      ev(
        "workflow_step_started",
        { stepId: "draft", iteration: 0 },
        "2026-06-20T12:00:00.000Z",
      ),
      // Interpreter's bare completion.
      ev(
        "workflow_step_finished",
        { stepId: "draft", iteration: 0, status: "completed" },
        "2026-06-20T12:00:04.000Z",
      ),
      // Finalize hook's evidence-bearing completion.
      ev(
        "workflow_step_finished",
        {
          stepId: "draft",
          iteration: 0,
          status: "completed",
          summary: "Drafted the report",
          tokensUsed: 4200,
        },
        "2026-06-20T12:00:06.000Z",
      ),
    ];

    const groups = foldTimeline(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].steps).toHaveLength(1);
    const step = groups[0].steps[0];
    expect(step.summary).toBe("Drafted the report");
    expect(step.tokensUsed).toBe(4200);
    expect(step.hasEvidence).toBe(true);
  });

  it("keeps a running step in progress when no finish event has arrived", () => {
    const groups = foldTimeline([
      ev(
        "workflow_step_started",
        { stepId: "wait", iteration: 0 },
        "2026-06-20T12:00:00.000Z",
      ),
    ]);
    expect(groups[0].steps[0].status).toBe("running");
    expect(groups[0].steps[0].finishedAt).toBeUndefined();
  });
});

describe("WorkflowRunTimeline", () => {
  it("renders the queued/empty state without crashing", () => {
    render(<WorkflowRunTimeline events={[]} />);
    expect(
      screen.getByText("No workflow steps have run yet."),
    ).toBeTruthy();
  });

  it("shows a failed step's error summary", () => {
    render(
      <WorkflowRunTimeline
        events={[
          ev(
            "workflow_step_started",
            { stepId: "gather", iteration: 0 },
            "2026-06-20T12:00:00.000Z",
          ),
          ev(
            "workflow_step_failed",
            {
              stepId: "gather",
              iteration: 0,
              errorSummary: "The upstream API timed out",
            },
            "2026-06-20T12:00:05.000Z",
          ),
        ]}
      />,
    );
    expect(screen.getByText("The upstream API timed out")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders an in-progress elapsed clock distinct from a settled duration", () => {
    render(
      <WorkflowRunTimeline
        events={[
          // Settled step in iteration 0.
          ev(
            "workflow_step_started",
            { stepId: "gather", iteration: 0 },
            "2026-06-20T12:00:00.000Z",
          ),
          ev(
            "workflow_step_finished",
            { stepId: "gather", iteration: 0, status: "completed" },
            "2026-06-20T12:00:03.000Z",
          ),
          // In-progress step in iteration 1 (started, never finished).
          ev(
            "workflow_step_started",
            { stepId: "gather", iteration: 1 },
            "2026-06-20T12:01:00.000Z",
          ),
        ]}
      />,
    );

    // The in-progress row exposes an elapsed ticker; the settled row a duration.
    expect(screen.getByTestId("step-elapsed")).toBeTruthy();
    expect(screen.getByText(/elapsed/)).toBeTruthy();
    expect(screen.getAllByTestId("step-duration").length).toBeGreaterThan(0);
  });

  it("renders policy, approval, and rollover markers", () => {
    render(
      <WorkflowRunTimeline
        events={[
          ev(
            "workflow_run_rollover",
            { iteration: 0, supersededExecutionArn: "arn:old" },
            "2026-06-20T12:00:00.000Z",
          ),
          ev(
            "workflow_policy_decision",
            {
              stepId: "review",
              iteration: 0,
              decision: "continue",
              reason: "exit signal not yet satisfied",
            },
            "2026-06-20T12:00:05.000Z",
          ),
          ev(
            "workflow_approval_decision",
            { iteration: 0, decision: "approved", summary: "looks good" },
            "2026-06-20T12:00:10.000Z",
          ),
        ]}
      />,
    );

    expect(screen.getByText("Policy decision")).toBeTruthy();
    expect(screen.getByText("exit signal not yet satisfied")).toBeTruthy();
    expect(screen.getByText("Operator decision")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(
      screen.getByText("Run rolled over to a fresh execution"),
    ).toBeTruthy();
  });

  it("labels a denied operator decision", () => {
    render(
      <WorkflowRunTimeline
        events={[
          ev(
            "workflow_approval_decision",
            { iteration: 0, decision: "rejected" },
            "2026-06-20T12:00:10.000Z",
          ),
        ]}
      />,
    );
    const decision = screen.getByText("Operator decision").closest("div");
    expect(within(decision as HTMLElement).getByText("Denied")).toBeTruthy();
  });
});
