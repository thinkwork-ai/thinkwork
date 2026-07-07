import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useMutationMock, useQueryMock } = vi.hoisted(() => ({
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: useQueryMock,
  // GitRoutineRunPanel's import graph pulls TenantContext (gql) and a
  // re-enable mutation; provide inert stand-ins.
  gql: (strings: TemplateStringsArray, ...rest: unknown[]) =>
    String.raw({ raw: strings }, ...rest),
  useMutation: useMutationMock,
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      to,
      children,
      className,
    }: {
      to: string;
      children: ReactNode;
      className?: string;
    }) => (
      <a href={to} className={className}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

import { WorkflowRunDetail } from "./WorkflowRunDetail";

beforeEach(() => {
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue([{ fetching: false }, vi.fn()]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type RunOverrides = Record<string, unknown>;

function baseRun(overrides: RunOverrides = {}) {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    workflowId: "workflow-1",
    workflow: { id: "workflow-1", name: "Weekly report", slug: "weekly" },
    workflowVersion: {
      id: "version-1",
      versionNumber: 2,
      versionStatus: "active",
      sourceKind: "workflow_interpreter",
      routineAslVersionId: null,
    },
    engineBinding: {
      id: "binding-1",
      bindingType: "step_functions_interpreter",
      bindingStatus: "ready",
      routineId: null,
      externalWorkflowId: null,
      externalWorkflowName: null,
      readinessState: "ready",
      readinessReasons: [],
    },
    status: "running",
    triggerFamily: "schedule",
    triggerSource: "workflow_schedule",
    actorType: "agent",
    actorId: "agent-1",
    idempotencyKey: "idem-1",
    correlationId: "corr-1",
    backendExecutionId:
      "arn:aws:states:us-east-1:123456789012:execution:machine:run-1",
    backendExecutionRef: {
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:machine:run-1",
    },
    capabilitySnapshot: {},
    readinessSnapshot: {},
    inputSummary: {},
    outputSummary: {},
    startedAt: "2026-06-20T12:00:00.000Z",
    finishedAt: null,
    lastEventAt: "2026-06-20T12:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    totalCostUsdCents: null,
    events: [],
    evidence: [],
    createdAt: "2026-06-20T12:00:00.000Z",
    updatedAt: "2026-06-20T12:00:00.000Z",
    ...overrides,
  };
}

function mockRun(overrides: RunOverrides = {}, refetch = vi.fn()) {
  useQueryMock.mockReturnValue([
    { fetching: false, data: { workflowRun: baseRun(overrides) } },
    refetch,
  ]);
  return refetch;
}

describe("WorkflowRunDetail", () => {
  it("renders n8n run evidence without Step Functions-only actions", () => {
    useQueryMock.mockReturnValue([
      {
        fetching: false,
        data: {
          workflowRun: {
            id: "run-1",
            workflowId: "workflow-1",
            workflow: {
              id: "workflow-1",
              name: "Invoice bridge",
              slug: "invoice-bridge",
            },
            workflowVersion: {
              id: "version-1",
              versionNumber: 4,
              versionStatus: "active",
              sourceKind: "n8n_bridge",
              routineAslVersionId: null,
            },
            engineBinding: {
              id: "binding-1",
              bindingType: "n8n_bridge",
              bindingStatus: "ready",
              externalWorkflowId: "wf-123",
              externalWorkflowName: "Invoice bridge",
              readinessState: "ready",
              readinessReasons: [],
            },
            status: "succeeded",
            triggerFamily: "n8n",
            triggerSource: "n8n:bridge",
            actorType: "connected_app",
            actorId: "n8n",
            idempotencyKey: "n8n-run-1",
            correlationId: "corr-1",
            backendExecutionId: "exec-1",
            backendExecutionRef: {
              sourceSystem: "n8n",
              executionId: "exec-1",
            },
            capabilitySnapshot: { cancel: false },
            readinessSnapshot: { state: "ready" },
            inputSummary: { body: "redacted" },
            outputSummary: { accepted: true },
            startedAt: "2026-06-20T12:00:00.000Z",
            finishedAt: "2026-06-20T12:00:03.000Z",
            lastEventAt: "2026-06-20T12:00:03.000Z",
            errorCode: null,
            errorMessage: null,
            totalCostUsdCents: null,
            events: [
              {
                id: "event-1",
                eventType: "n8n_bridge_request",
                eventStatus: "succeeded",
                provenance: "native_event",
                occurredAt: "2026-06-20T12:00:00.000Z",
                message: "n8n workflow bridge request accepted",
                payloadSummary: { executionId: "exec-1" },
                evidenceRef: { sourceSystem: "n8n" },
              },
            ],
            evidence: [
              {
                id: "evidence-1",
                evidenceType: "n8n_execution",
                sourceSystem: "n8n",
                sourceId: "exec-1",
                uri: null,
                summary: { executionId: "exec-1" },
                redactionState: "summary_only",
                sensitivity: null,
                retentionExpiresAt: null,
              },
            ],
            createdAt: "2026-06-20T12:00:00.000Z",
            updatedAt: "2026-06-20T12:00:03.000Z",
          },
        },
      },
      vi.fn(),
    ]);

    render(<WorkflowRunDetail workflowId="workflow-1" runId="run-1" />);

    expect(screen.getByText("Invoice bridge")).toBeTruthy();
    expect(screen.getByText("N8n Bridge Request")).toBeTruthy();
    expect(screen.getByText("N8n Execution")).toBeTruthy();
    expect(screen.queryByText("Step Functions execution")).toBeNull();
  });

  it("renders the Diagnostics execution link from backendExecutionRef", () => {
    mockRun();
    render(<WorkflowRunDetail workflowId="workflow-1" runId="run-1" />);
    const link = screen.getByText("Open execution").closest("a");
    expect(link?.getAttribute("href")).toContain(
      "us-east-1.console.aws.amazon.com/states",
    );
  });

  it("renders Approve/Deny and fires the approval mutation when waiting for human", () => {
    const approve = vi.fn().mockResolvedValue({ data: {} });
    useMutationMock.mockReturnValue([{ fetching: false }, approve]);
    mockRun({ status: "waiting_for_human" });

    render(<WorkflowRunDetail workflowId="workflow-1" runId="run-1" />);

    const approveButton = screen.getByRole("button", { name: "Approve" });
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();

    fireEvent.click(approveButton);
    expect(approve).toHaveBeenCalledWith({
      runId: "run-1",
      approve: true,
      note: null,
    });
  });

  it("disables both buttons and shows an inline message when the approval mutation fails", async () => {
    const approve = vi
      .fn()
      .mockResolvedValue({ error: new Error("already left waiting") });
    useMutationMock.mockReturnValue([{ fetching: false }, approve]);
    mockRun({ status: "waiting_for_human" });

    render(<WorkflowRunDetail workflowId="workflow-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() =>
      expect(
        screen.getByText(/already left the waiting state/i),
      ).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("polls a non-terminal run and stops polling once terminal", () => {
    vi.useFakeTimers();

    const runningRefetch = mockRun({ status: "running" });
    const { unmount } = render(
      <WorkflowRunDetail workflowId="workflow-1" runId="run-1" />,
    );
    vi.advanceTimersByTime(11000);
    expect(runningRefetch.mock.calls.length).toBeGreaterThan(0);
    unmount();

    const terminalRefetch = mockRun({
      status: "succeeded",
      finishedAt: "2026-06-20T12:05:00.000Z",
    });
    render(<WorkflowRunDetail workflowId="workflow-1" runId="run-1" />);
    vi.advanceTimersByTime(20000);
    expect(terminalRefetch).not.toHaveBeenCalled();
  });
});
