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

beforeEach(() => {
  navigateMock.mockReset();
  useQueryMock.mockReset();
});

afterEach(cleanup);

describe("WorkflowInventory", () => {
  it("shows ready and blocked workflows from multiple sources", () => {
    useQueryMock.mockReturnValue([
      {
        fetching: false,
        data: {
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
        },
      },
    ]);

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
});
