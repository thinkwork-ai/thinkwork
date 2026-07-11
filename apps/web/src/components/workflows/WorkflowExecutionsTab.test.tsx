import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("urql", () => ({ useQuery: useQueryMock }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="#run">{children}</a>
  ),
}));
vi.mock("@/components/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("@/components/routines/RoutineFlowCanvas", () => ({
  RoutineFlowCanvas: ({
    onSelectNode,
  }: {
    onSelectNode?: (id: string | null) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectNode?.("work")}>
        Select work
      </button>
      <button type="button" onClick={() => onSelectNode?.(null)}>
        Clear node
      </button>
    </div>
  ),
}));

import { WorkflowExecutionsTab } from "./WorkflowExecutionsTab";

const graph = {
  nodes: [
    {
      id: "work",
      stateName: "work",
      label: "Agent work",
      kind: "agent",
      position: { x: 0, y: 0 },
      width: 230,
      height: 86,
    },
  ],
  edges: [],
};

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockImplementation(({ pause }: { pause?: boolean }) => [
    pause
      ? { fetching: false, data: {} }
      : {
          fetching: false,
          data: {
            workflowRun: {
              id: "run-1",
              status: "succeeded",
              triggerFamily: "schedule",
              correlationId: "corr-1",
              startedAt: "2026-07-11T11:00:00.000Z",
              finishedAt: "2026-07-11T11:01:00.000Z",
              workflowVersion: { versionNumber: 2 },
              events: [
                {
                  id: "event-1",
                  eventType: "workflow_step_finished",
                  eventStatus: "succeeded",
                  occurredAt: "2026-07-11T11:01:00.000Z",
                  message: "Agent work completed",
                  payloadSummary: { nodeId: "work", status: "succeeded" },
                },
              ],
            },
          },
        },
  ]);
});

afterEach(cleanup);

describe("WorkflowExecutionsTab", () => {
  it("switches the right rail between run and selected-node information", () => {
    render(
      <WorkflowExecutionsTab
        executions={[
          {
            id: "run-1",
            source: "workflow",
            status: "succeeded",
            triggerFamily: "schedule",
            correlationId: "corr-1",
            startedAt: "2026-07-11T11:00:00.000Z",
            finishedAt: "2026-07-11T11:01:00.000Z",
            createdAt: "2026-07-11T11:00:00.000Z",
          },
        ]}
        graph={graph}
      />,
    );

    expect(screen.queryByText("Execution information")).toBeNull();
    expect(screen.queryByText("Open run detail")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(screen.getByText("Execution information")).toBeTruthy();
    expect(screen.getByText("Workflow ledger")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Select work" }));
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getByText("Agent work completed")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to execution information" }),
    );
    expect(screen.queryByText("Execution information")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(screen.getByText("Execution information")).toBeTruthy();
  });

  it("labels historical AgentLoop runs and does not invent node telemetry", () => {
    useQueryMock.mockImplementation(({ pause }: { pause?: boolean }) => [
      pause
        ? { fetching: false, data: {} }
        : {
            fetching: false,
            data: {
              agentLoopRun: {
                id: "legacy-1",
                threadId: "thread-1",
                iterations: [],
              },
            },
          },
    ]);
    render(
      <WorkflowExecutionsTab
        executions={[
          {
            id: "legacy-1",
            source: "agent_loop",
            status: "succeeded",
            triggerFamily: "manual",
            createdAt: "2026-07-10T11:00:00.000Z",
          },
        ]}
        graph={graph}
      />,
    );

    expect(screen.getByText("Legacy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select work" }));
    expect(
      screen.getByText(
        "No step-level telemetry was recorded for this legacy execution.",
      ),
    ).toBeTruthy();
  });
});
