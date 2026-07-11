import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock, useMutationMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="#link">{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));
vi.mock("@/components/agent-loops/useAutomationEditorData", () => ({
  useAutomationEditorData: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    workerOptions: [],
    spaceOptions: [],
    routineOptions: [],
    workflowOptions: [],
    memberOptions: [],
    defaultSpaceId: null,
  }),
}));
vi.mock("@/components/agent-loops/AutomationFlowSection", () => ({
  AutomationFlowSection: ({ loop }: { loop: { name: string } }) => (
    <div data-testid="automation-definition">{loop.name}</div>
  ),
}));
vi.mock("@/components/agent-loops/AutomationStatusRail", () => ({
  AutomationStatusRail: () => <div>General information</div>,
}));
vi.mock("./WorkflowDefinitionTab", () => ({
  WorkflowDefinitionTab: () => <div data-testid="generic-definition" />,
}));
vi.mock("./WorkflowExecutionsTab", () => ({
  WorkflowExecutionsTab: () => <div data-testid="executions" />,
}));
vi.mock("./WorkflowFormDialog", () => ({ WorkflowFormDialog: () => null }));

import { WorkflowDetail } from "./WorkflowDetail";

afterEach(cleanup);

beforeEach(() => {
  useMutationMock.mockReset().mockReturnValue([{ fetching: false }, vi.fn()]);
  useQueryMock.mockReset().mockReturnValue([
    {
      fetching: false,
      data: {
        workflow: {
          id: "workflow-1",
          name: "Daily sales review",
          slug: "daily-sales-review",
          lifecycleStatus: "active",
          visibility: "tenant_shared",
          primaryTriggerFamily: "schedule",
          readinessState: "ready",
          readinessReasons: [],
          currentVersionNumber: 2,
          currentVersion: {
            id: "workflow-version-2",
            versionNumber: 2,
            versionStatus: "active",
            sourceKind: "workflow_interpreter",
            definitionSnapshot: { steps: [] },
            createdAt: "2026-07-11T00:00:00.000Z",
          },
          triggers: [],
          bindings: [],
          runs: [],
          sourceAutomation: {
            id: "loop-1",
            tenantId: "tenant-1",
            name: "Daily sales review",
            slug: "daily-sales-review",
            lifecycleStatus: "active",
            enabled: true,
            primaryTriggerFamily: "schedule",
            runs: [],
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      },
    },
    vi.fn(),
  ]);
});

describe("WorkflowDetail", () => {
  it("uses the shared Automation definition for a linked Workflow", () => {
    render(<WorkflowDetail workflowId="workflow-1" />);

    expect(screen.getByTestId("automation-definition")).toBeTruthy();
    expect(screen.queryByTestId("generic-definition")).toBeNull();
  });

  it("resolves the shared Automation editor during a rolling schema deploy", () => {
    const baseWorkflow = {
      id: "workflow-1",
      name: "Daily sales review",
      slug: "automation-702f221d",
      lifecycleStatus: "active",
      visibility: "tenant_shared",
      primaryTriggerFamily: "schedule",
      readinessState: "ready",
      readinessReasons: [],
      currentVersionNumber: 2,
      currentVersion: {
        id: "workflow-version-2",
        versionNumber: 2,
        versionStatus: "active",
        sourceKind: "workflow_interpreter",
        definitionSnapshot: { steps: [] },
        createdAt: "2026-07-11T00:00:00.000Z",
      },
      triggers: [],
      bindings: [],
      runs: [],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    const sourceAutomation = {
      id: "702f221d-020f-49a8-aef7-0579eafe6570",
      tenantId: "tenant-1",
      name: "Daily sales review",
      slug: "daily-sales-review",
      lifecycleStatus: "active",
      enabled: true,
      primaryTriggerFamily: "schedule",
      runs: [],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    useQueryMock
      .mockReset()
      .mockReturnValueOnce([
        { fetching: false, data: { workflow: baseWorkflow } },
        vi.fn(),
      ])
      .mockReturnValueOnce([
        {
          fetching: false,
          error: new Error('Cannot query field "sourceAutomation"'),
        },
        vi.fn(),
      ])
      .mockReturnValueOnce([
        { fetching: false, data: { agentLoops: [sourceAutomation] } },
        vi.fn(),
      ])
      .mockReturnValueOnce([
        { fetching: false, data: { agentLoop: sourceAutomation } },
        vi.fn(),
      ]);

    render(<WorkflowDetail workflowId="workflow-1" />);

    expect(screen.getByTestId("automation-definition").textContent).toBe(
      "Daily sales review",
    );
    expect(screen.queryByTestId("generic-definition")).toBeNull();
  });
});
