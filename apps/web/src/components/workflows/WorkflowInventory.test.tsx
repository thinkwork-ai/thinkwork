import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, useMutationMock, useQueryMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      children,
      params,
      to,
      ...props
    }: {
      children: ReactNode;
      params?: Record<string, string>;
      to: string;
    }) => {
      const href = params
        ? Object.entries(params).reduce(
            (path, [key, value]) => path.replace(`$${key}`, value),
            to,
          )
        : to;
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
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
import { SettingsWorkflowsQuery } from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";

function mockWorkflowInventoryQueries({
  workflows,
  tenantMembers = [],
}: {
  workflows: unknown[];
  tenantMembers?: unknown[];
}) {
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === SettingsWorkflowsQuery) {
      return [
        {
          fetching: false,
          data: { workflows },
        },
      ];
    }

    if (query === SettingsTenantMembersQuery) {
      return [
        {
          fetching: false,
          data: { tenantMembers },
        },
      ];
    }

    return [
      {
        fetching: false,
        data: {},
      },
      vi.fn(),
    ];
  });
  useMutationMock.mockReturnValue([{ fetching: false }, vi.fn()]);
}

beforeEach(() => {
  navigateMock.mockReset();
  useMutationMock.mockReset();
  useQueryMock.mockReset();
});

afterEach(cleanup);

describe("WorkflowInventory", () => {
  it("shows ready and blocked workflows", () => {
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
    expect(screen.getAllByText("Blocked Not Ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("missing_secret")).toBeNull();
    expect(screen.queryByText("Step Functions routine")).toBeNull();
    expect(screen.queryByText("Version")).toBeNull();
    expect(screen.queryByText("Last run")).toBeNull();
  });

  it("orders the compact columns and marks Automations with a check", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-automation",
          name: "Eric's pipeline report",
          lifecycleStatus: "active",
          ownerUserId: "user-eric",
          sourceAgentLoopId: "loop-1",
          primaryTriggerFamily: "schedule",
          readinessState: "ready",
          readinessReasons: [],
          bindings: [],
          triggers: [],
        },
        {
          id: "workflow-manual",
          name: "Manual workflow",
          lifecycleStatus: "active",
          primaryTriggerFamily: "manual",
          readinessState: "ready",
          readinessReasons: [],
          bindings: [],
          triggers: [],
        },
      ],
      tenantMembers: [
        {
          principalId: "user-eric",
          user: {
            id: "user-eric",
            name: "Eric Odom",
            email: "eric@example.com",
          },
        },
      ],
    });

    render(<WorkflowInventory />);

    expect(
      screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual(["Workflow", "Owner", "Trigger", "Automation", "Status"]);
    expect(screen.queryByRole("columnheader", { name: "Source" })).toBeNull();
    expect(screen.getAllByRole("img", { name: "Automation" })).toHaveLength(1);
    const manualRow = screen.getByText("Manual workflow").closest("tr");
    expect(manualRow?.children.item(3)?.textContent).toBe("");
    expect(screen.getByText("Eric Odom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(
      within(screen.getByRole("dialog"))
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Automation", "Owner", "Status", "Trigger"]);
    expect(screen.getByRole("button", { name: /^Automation$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Owner$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Source$/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Automation$/ }));
    expect(screen.getByRole("checkbox", { name: "Yes" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "No" })).toBeTruthy();
  });

  it("shows a Looping badge when the current version defines a continuation policy", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-loop",
          name: "Weekly report loop",
          lifecycleStatus: "active",
          primaryTriggerFamily: "schedule",
          currentVersionNumber: 2,
          currentVersion: {
            id: "version-loop",
            definitionSnapshot: {
              version: 1,
              steps: [{ id: "draft", kind: "agent", objective: "write it" }],
              continuationPolicy: {
                exitSignal: "the report is shared",
                maxIterations: 5,
              },
            },
          },
          readinessState: "ready",
          readinessReasons: [],
          bindings: [
            {
              id: "binding-loop",
              bindingType: "native",
              bindingStatus: "ready",
            },
          ],
          triggers: [],
        },
      ],
    });

    render(<WorkflowInventory />);

    expect(screen.getByText("Looping")).toBeTruthy();
  });

  it("omits the Looping badge when the current version has no continuation policy", () => {
    mockWorkflowInventoryQueries({
      workflows: [
        {
          id: "workflow-linear",
          name: "One-shot report",
          lifecycleStatus: "active",
          primaryTriggerFamily: "schedule",
          currentVersionNumber: 1,
          currentVersion: {
            id: "version-linear",
            definitionSnapshot: {
              version: 1,
              steps: [{ id: "draft", kind: "agent", objective: "write it" }],
            },
          },
          readinessState: "ready",
          readinessReasons: [],
          bindings: [
            {
              id: "binding-linear",
              bindingType: "native",
              bindingStatus: "ready",
            },
          ],
          triggers: [],
        },
      ],
    });

    render(<WorkflowInventory />);

    expect(screen.getByText("One-shot report")).toBeTruthy();
    expect(screen.queryByText("Looping")).toBeNull();
  });
});
