import { describe, expect, it } from "vitest";
import type { AgentLoopRow } from "@/components/agent-loops/agent-loop-types";
import {
  automationRunTarget,
  mergeAutomationExecutions,
} from "./workflow-execution-model";

describe("workflow execution model", () => {
  it("chooses the canonical Workflow for a ready linked Automation", () => {
    expect(
      automationRunTarget({
        id: "loop-1",
        linkedWorkflow: {
          id: "workflow-1",
          name: "Report",
          readinessState: "ready",
          runs: [],
        },
      } as unknown as AgentLoopRow),
    ).toEqual({ kind: "workflow", id: "workflow-1" });
  });

  it("keeps legacy dispatch for non-converged Automations", () => {
    expect(automationRunTarget({ id: "loop-1" } as AgentLoopRow)).toEqual({
      kind: "agent_loop",
      id: "loop-1",
    });
  });

  it("merges canonical scheduled and historical manual executions newest first", () => {
    const result = mergeAutomationExecutions(
      [
        {
          id: "workflow-run",
          status: "succeeded",
          triggerFamily: "schedule",
          startedAt: "2026-07-11T11:00:00.000Z",
          createdAt: "2026-07-11T11:00:00.000Z",
        },
      ],
      [
        {
          id: "legacy-run",
          status: "completed",
          triggerFamily: "manual",
          currentIteration: 1,
          startedAt: "2026-07-10T19:00:00.000Z",
          createdAt: "2026-07-10T19:00:00.000Z",
        },
      ],
    );

    expect(
      result.map(({ id, source, status }) => ({ id, source, status })),
    ).toEqual([
      { id: "workflow-run", source: "workflow", status: "succeeded" },
      { id: "legacy-run", source: "agent_loop", status: "succeeded" },
    ]);
  });

  it("prefers the canonical row when explicit correlation matches", () => {
    const result = mergeAutomationExecutions(
      [
        {
          id: "workflow-run",
          status: "succeeded",
          triggerFamily: "manual",
          correlationId: "same-run",
          createdAt: "2026-07-11T11:00:00.000Z",
        },
      ],
      [
        {
          id: "legacy-run",
          status: "completed",
          triggerFamily: "manual",
          correlationId: "same-run",
          currentIteration: 1,
          createdAt: "2026-07-11T11:00:00.000Z",
        },
      ],
    );

    expect(result.map((run) => run.id)).toEqual(["workflow-run"]);
  });

  it("does not collapse unrelated runs that share a timestamp", () => {
    const at = "2026-07-11T11:00:00.000Z";
    expect(
      mergeAutomationExecutions(
        [
          {
            id: "workflow-run",
            status: "succeeded",
            triggerFamily: "schedule",
            createdAt: at,
          },
        ],
        [
          {
            id: "legacy-run",
            status: "completed",
            triggerFamily: "manual",
            currentIteration: 1,
            createdAt: at,
          },
        ],
      ),
    ).toHaveLength(2);
  });
});
