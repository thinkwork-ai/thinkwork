import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, useQueryMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
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
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

import { WorkflowInventory } from "./WorkflowInventory";

function mockWorkflowInventoryQueries({
  workflows,
  pluginCatalog = [],
  managedApplications = [],
}: {
  workflows: unknown[];
  pluginCatalog?: unknown[];
  managedApplications?: unknown[];
}) {
  useQueryMock
    .mockReturnValueOnce([
      {
        fetching: false,
        data: { workflows },
      },
    ])
    .mockReturnValueOnce([
      {
        fetching: false,
        data: { pluginCatalog },
      },
    ])
    .mockReturnValueOnce([
      {
        fetching: false,
        data: {
          deploymentStatus: {
            managedApplications,
          },
        },
      },
    ]);
}

beforeEach(() => {
  navigateMock.mockReset();
  useQueryMock.mockReset();
});

afterEach(cleanup);

describe("WorkflowInventory", () => {
  it("shows ready and blocked workflows from multiple sources", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-step",
          name: "Nightly customer sync",
          description: "Step Functions routine",
          lifecycleStatus: "active",
          primaryTriggerFamily: "schedule",
          currentVersionNumber: 3,
          readinessState: "ready",
          readinessReasons: [],
          bindings: [
            {
              id: "binding-step",
              bindingType: "step_functions_routine",
              bindingStatus: "ready",
              routineId: "routine-1",
            },
          ],
          triggers: [],
          lastRunAt: "2026-06-20T12:00:00.000Z",
        },
        {
          id: "workflow-n8n",
          name: "Invoice bridge",
          description: "Imported from n8n",
          lifecycleStatus: "active",
          primaryTriggerFamily: "n8n",
          currentVersionNumber: 1,
          readinessState: "blocked_not_ready",
          readinessReasons: [{ code: "missing_secret" }],
          bindings: [
            {
              id: "binding-n8n",
              bindingType: "n8n_bridge",
              bindingStatus: "blocked_not_ready",
              externalWorkflowName: "Invoice bridge",
            },
          ],
          triggers: [],
          lastRunAt: null,
        },
      ],
    });

    render(<WorkflowInventory />);

    expect(screen.getByText("Nightly customer sync")).toBeTruthy();
    expect(screen.getByText("Invoice bridge")).toBeTruthy();
    expect(screen.getAllByText("AWS Step").length).toBeGreaterThan(0);
    expect(screen.getAllByText("n8n bridge").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked Not Ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("Step Functions routine")).toBeNull();
    expect(screen.queryByText("Version")).toBeNull();
    expect(screen.queryByText("Last run")).toBeNull();
  });

  it("links n8n bridge source badges to n8n workflows when no direct workflow id exists", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-n8n",
          name: "Webhook bridge",
          description: "Manually bridged from n8n",
          lifecycleStatus: "active",
          primaryTriggerFamily: "webhook",
          readinessState: "ready",
          readinessReasons: [],
          bindings: [
            {
              id: "binding-n8n",
              bindingType: "n8n_bridge",
              bindingStatus: "ready",
              externalWorkflowName: "Webhook bridge",
            },
          ],
          triggers: [],
        },
      ],
      pluginCatalog: [
        {
          pluginKey: "n8n",
          launchUrl: "https://n8n.example.test",
          install: { id: "install-n8n" },
        },
      ],
    });

    render(<WorkflowInventory />);

    expect(
      screen.getByText("n8n bridge").closest("a")?.getAttribute("href"),
    ).toBe("/settings/plugins/n8n/workflows");
  });

  it("deep-links n8n bridge source badges to the configured n8n workflow", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-n8n",
          name: "Invoice bridge",
          description: "Connected from n8n",
          lifecycleStatus: "active",
          primaryTriggerFamily: "n8n",
          readinessState: "ready",
          readinessReasons: [],
          bindings: [
            {
              id: "binding-n8n",
              bindingType: "n8n_bridge",
              bindingStatus: "ready",
              externalWorkflowId: "workflow-from-n8n",
              externalWorkflowName: "Invoice bridge",
            },
          ],
          triggers: [],
        },
      ],
      pluginCatalog: [
        {
          pluginKey: "n8n",
          launchUrl: null,
          install: { id: "install-n8n" },
        },
      ],
      managedApplications: [
        {
          key: "n8n",
          url: "https://n8n.example.test",
        },
      ],
    });

    render(<WorkflowInventory />);

    const link = screen.getByText("n8n bridge").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "https://n8n.example.test/workflow/workflow-from-n8n",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
