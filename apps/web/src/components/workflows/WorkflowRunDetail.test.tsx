import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: useQueryMock,
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
});

afterEach(cleanup);

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
});
