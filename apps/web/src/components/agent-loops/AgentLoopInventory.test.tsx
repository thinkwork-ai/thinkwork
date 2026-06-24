import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopRow } from "./agent-loop-types";

const navigateMock = vi.fn();
const saveMutationMock = vi.fn();
const refetchMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, saveMutationMock],
  useQuery: (args: unknown) => useQueryMock(args),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading</div>,
}));

vi.mock("@/components/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsPane: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  SettingsTablePane: ({
    actions,
    children,
    title,
    toolbar,
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    title: string;
    toolbar?: React.ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {actions}
      {toolbar}
      {children}
    </section>
  ),
}));

vi.mock("./AgentLoopForm", () => ({
  AgentLoopForm: ({ onSubmit }: { onSubmit: (value: unknown) => void }) => (
    <button type="button" onClick={() => onSubmit({ name: "Created" })}>
      Save mocked loop
    </button>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DataTable: ({
    data,
    emptyState,
    onRowClick,
  }: {
    data: AgentLoopRow[];
    emptyState?: React.ReactNode;
    onRowClick?: (row: AgentLoopRow) => void;
  }) => (
    <div>
      {data.length
        ? data.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onRowClick?.(row)}
            >
              {row.name}
            </button>
          ))
        : emptyState}
    </div>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

import { AgentLoopInventory, buildWorkerOptions } from "./AgentLoopInventory";

function loop(overrides: Partial<AgentLoopRow> = {}): AgentLoopRow {
  return {
    id: "loop-1",
    tenantId: "tenant-1",
    name: "Weekly Agent Check-In",
    slug: "weekly-agent-check-in",
    description: "Review open work",
    lifecycleStatus: "active",
    enabled: true,
    primaryTriggerFamily: "schedule",
    currentVersionId: "version-1",
    currentVersionNumber: 1,
    currentVersion: {
      id: "version-1",
      versionNumber: 1,
      triggerSpec: {
        family: "schedule",
        config: { scheduleExpression: "rate(7 days)" },
      },
      goalSpec: {},
      workerSpec: {},
      judgeSpec: {},
      loopPolicy: {},
      evidencePolicy: {},
    },
    lastRunId: null,
    lastRunStatus: null,
    lastRunAt: null,
    lastRunSummary: {},
    acceptedRunCount: 0,
    rejectedRunCount: 0,
    escalatedRunCount: 0,
    totalCostUsdCents: 0,
    costPerAcceptedRunUsdCents: null,
    runs: [],
    createdAt: "2026-06-22T12:00:00.000Z",
    updatedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  navigateMock.mockReset();
  saveMutationMock.mockReset();
  refetchMock.mockReset();
  useQueryMock.mockReset();
  let queryCall = 0;
  useQueryMock.mockImplementation(() => {
    const index = queryCall++ % 4;
    if (index === 0) {
      return [{ data: { agentLoops: [loop()] }, fetching: false }, refetchMock];
    }
    if (index === 1) {
      return [
        {
          data: {
            agent: {
              id: "agent-1",
              name: "Default Agent",
              runtimeConfig: { defaultSpaceId: "space-1" },
            },
          },
        },
        vi.fn(),
      ];
    }
    if (index === 2) {
      return [
        {
          data: {
            agentProfiles: [
              {
                id: "profile-1",
                name: "Research",
                description: "Research profile",
                enabled: true,
              },
            ],
          },
        },
        vi.fn(),
      ];
    }
    return [
      {
        data: {
          spaces: [{ id: "space-1", name: "Customer", slug: "customer" }],
        },
      },
      vi.fn(),
    ];
  });
});

afterEach(() => cleanup());

describe("AgentLoopInventory", () => {
  it("opens automation rows through the AgentLoop detail route", async () => {
    render(<AgentLoopInventory />);

    fireEvent.click(await screen.findByText("Weekly Agent Check-In"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/agent-loops/$agentLoopId",
      params: { agentLoopId: "loop-1" },
    });
  });

  it("opens main-nav automation rows through the user Automation route", async () => {
    render(<AgentLoopInventory routeScope="main" />);

    fireEvent.click(await screen.findByText("Weekly Agent Check-In"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/automations/$scheduledJobId",
      params: { scheduledJobId: "loop-1" },
    });
  });

  it("creates automations and navigates to the created loop", async () => {
    saveMutationMock.mockResolvedValue({
      data: { saveAgentLoop: { id: "loop-new" } },
    });

    render(<AgentLoopInventory />);
    fireEvent.click(screen.getByRole("button", { name: /New Automation/ }));
    fireEvent.click(await screen.findByText("Save mocked loop"));

    await waitFor(() => expect(saveMutationMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/agent-loops/$agentLoopId",
      params: { agentLoopId: "loop-new" },
    });
  });

  it("hides archived automations from the active inventory", async () => {
    useQueryMock.mockImplementation(() => [
      {
        data: {
          agentLoops: [
            loop(),
            loop({
              id: "loop-archived",
              name: "Archived loop",
              lifecycleStatus: "archived",
            }),
          ],
        },
        fetching: false,
      },
      refetchMock,
    ]);

    render(<AgentLoopInventory />);

    expect(await screen.findByText("Weekly Agent Check-In")).toBeTruthy();
    expect(screen.queryByText("Archived loop")).toBeNull();
  });

  it("builds Phase 1 worker choices from default Agent plus enabled profiles", () => {
    expect(
      buildWorkerOptions({
        agent: { id: "agent-1", name: "Default Agent" },
        profiles: [
          { id: "profile-1", name: "Research", enabled: true },
          { id: "profile-2", name: "Disabled", enabled: false },
        ],
      }),
    ).toEqual([
      {
        id: "agent-1",
        type: "agent",
        label: "Default Agent",
        description: "Tenant default Agent",
      },
      {
        id: "profile-1",
        type: "agent_profile",
        label: "Research",
        description: undefined,
      },
    ]);
  });
});
