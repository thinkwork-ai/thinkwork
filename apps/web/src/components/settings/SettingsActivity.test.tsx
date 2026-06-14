import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery, useSubscription } from "urql";
import { useNavigate } from "@tanstack/react-router";
import type {
  ActivityItem,
  ActivityThreadSummary,
} from "@/lib/settings-activity";

const reexecuteThreadsMock = vi.fn();
const navigateMock = vi.fn();
const usePageHeaderActionsMock = vi.hoisted(() => vi.fn());

let queryItems: ActivityThreadSummary[] = [];
let queryFetching = false;
let queryError: undefined;
let subscriptionResults: unknown[] = [];

vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useSubscription: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: usePageHeaderActionsMock,
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ChartContainer: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { config?: unknown }) => (
    <div {...props}>{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  DataTable: ({
    data,
    emptyState,
    onRowClick,
  }: {
    data: ActivityItem[];
    emptyState?: React.ReactNode;
    onRowClick?: (item: ActivityItem) => void;
  }) => (
    <div data-testid="activity-table">
      {data.length
        ? data.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onRowClick?.(item)}
            >
              {item.title}
            </button>
          ))
        : emptyState}
    </div>
  ),
  DisplayViewControl: ({
    modes,
    onStateChange,
    state,
  }: {
    modes: Array<{ value: "table" | "list"; label: string }>;
    state: { view: "table" | "list" };
    onStateChange: (state: unknown) => void;
  }) => (
    <div data-testid="activity-display-control">
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          onClick={() => onStateChange({ ...state, view: mode.value })}
        >
          {mode.label}
        </button>
      ))}
    </div>
  ),
  GroupedListView: ({
    groups,
    renderRow,
    emptyState,
  }: {
    groups: Array<{
      id: string;
      label: string;
      rows: ActivityItem[];
      subgroups?: Array<{ id: string; label: string; rows: ActivityItem[] }>;
    }>;
    renderRow: (row: ActivityItem) => React.ReactNode;
    emptyState?: React.ReactNode;
  }) => {
    const rows = groups.flatMap((group) =>
      group.subgroups?.length
        ? group.subgroups.flatMap((subgroup) => subgroup.rows)
        : group.rows,
    );
    return (
      <div data-testid="activity-list-view">
        {rows.length
          ? rows.map((row) => <div key={row.id}>{renderRow(row)}</div>)
          : emptyState}
      </div>
    );
  },
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: (state: unknown) => void;
  }) => (
    <button
      aria-label="Select May 31"
      type="button"
      onClick={() =>
        onClick?.({
          activePayload: [{ payload: { day: "2026-05-31" } }],
        })
      }
    >
      {children}
    </button>
  ),
  Cell: () => null,
  XAxis: () => null,
}));

import { ACTIVITY_DISPLAY_CONFIG, SettingsActivity } from "./SettingsActivity";

function thread(
  overrides: Partial<ActivityThreadSummary> = {},
): ActivityThreadSummary {
  return {
    id: "thread-1",
    number: 979,
    identifier: "CHAT-979",
    title: "AgentCore retry",
    status: "IN_PROGRESS",
    channel: "CHAT",
    costSummary: 0.0006,
    lastActivityAt: "2026-05-31T14:00:00.000Z",
    updatedAt: "2026-05-31T14:00:00.000Z",
    createdAt: "2026-05-31T14:00:00.000Z",
    agent: { id: "agent-1", name: "Pi" },
    ...overrides,
  };
}

beforeEach(() => {
  queryItems = [
    thread(),
    thread({
      id: "thread-2",
      number: 1043,
      identifier: "CHAT-1043",
      title: "What is SpaceX?",
      lastActivityAt: "2026-06-01T14:00:00.000Z",
      updatedAt: "2026-06-01T14:00:00.000Z",
      createdAt: "2026-06-01T14:00:00.000Z",
    }),
  ];
  queryFetching = false;
  queryError = undefined;
  subscriptionResults = [null, null];
  reexecuteThreadsMock.mockReset();
  navigateMock.mockReset();
  usePageHeaderActionsMock.mockReset();
  vi.mocked(useNavigate).mockReturnValue(navigateMock);
  vi.mocked(useQuery).mockImplementation(() => [
    {
      data: {
        threadsPaged: {
          totalCount: queryItems.length,
          items: queryItems,
        },
      },
      fetching: queryFetching,
      error: queryError,
      stale: false,
      hasNext: false,
    },
    reexecuteThreadsMock,
  ]);
  vi.mocked(useSubscription).mockImplementation(() => [
    {
      data: subscriptionResults.shift() ?? null,
      fetching: false,
      stale: false,
      hasNext: false,
    },
    vi.fn(),
  ]);
});

afterEach(() => {
  cleanup();
});

describe("SettingsActivity", () => {
  it("filters rows by selected day and keeps the date controls beside search below the chart", () => {
    const onSelectedDayChange = vi.fn();

    render(
      <SettingsActivity
        selectedDay="2026-05-31"
        onSelectedDayChange={onSelectedDayChange}
      />,
    );

    expect(screen.getByLabelText("Search activity")).toBeTruthy();
    expect(
      screen
        .getByTestId("activity-chart")
        .compareDocumentPosition(screen.getByTestId("activity-toolbar")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("activity-toolbar").textContent).toContain(
      "2 items",
    );
    expect(screen.getByText("May 31")).toBeTruthy();
    expect(screen.getByText("Clear date filter")).toBeTruthy();
    expect(screen.getByText("CHAT-979: AgentCore retry")).toBeTruthy();
    expect(screen.queryByText("CHAT-1043: What is SpaceX?")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search activity"), {
      target: { value: "agentcore" },
    });
    expect(screen.getByDisplayValue("agentcore")).toBeTruthy();

    fireEvent.click(screen.getByText("Clear date filter"));
    expect(onSelectedDayChange).toHaveBeenCalledWith(null);
  });

  it("selects a chart day and navigates clicked rows with the day filter", () => {
    const onSelectedDayChange = vi.fn();

    render(
      <SettingsActivity
        selectedDay="2026-05-31"
        onSelectedDayChange={onSelectedDayChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select May 31" }));
    expect(onSelectedDayChange).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText("CHAT-979: AgentCore retry"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/activity/$threadId",
      params: { threadId: "thread-1" },
      search: { day: "2026-05-31" },
      state: expect.any(Function),
    });
    const stateUpdater = navigateMock.mock.calls[0]?.[0].state as (
      previous: Record<string, unknown>,
    ) => Record<string, unknown>;
    expect(stateUpdater({ keep: true })).toEqual({
      keep: true,
      threadTitleFallback: {
        threadId: "thread-1",
        title: "CHAT-979: AgentCore retry",
      },
    });
  });

  it("renders Activity list mode with Table/List controls and preserves row navigation", () => {
    const onDisplayStateChange = vi.fn();

    render(
      <SettingsActivity
        selectedDay="2026-05-31"
        displayState={{ ...ACTIVITY_DISPLAY_CONFIG.defaults, view: "list" }}
        onDisplayStateChange={onDisplayStateChange}
      />,
    );

    expect(screen.getByTestId("activity-list-view")).toBeTruthy();
    expect(screen.getByText("Table")).toBeTruthy();
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.queryByText("Board")).toBeNull();
    expect(screen.getByText("CHAT-979: AgentCore retry")).toBeTruthy();
    expect(screen.queryByText("CHAT-1043: What is SpaceX?")).toBeNull();

    fireEvent.click(screen.getByText("Table"));
    expect(onDisplayStateChange).toHaveBeenCalledWith({
      ...ACTIVITY_DISPLAY_CONFIG.defaults,
      view: "table",
    });

    fireEvent.click(screen.getByText("CHAT-979: AgentCore retry"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/activity/$threadId",
      params: { threadId: "thread-1" },
      search: { view: "list", day: "2026-05-31" },
      state: expect.any(Function),
    });
  });

  it("refreshes manually and when thread subscriptions publish updates", async () => {
    subscriptionResults = [{ onThreadUpdated: { id: "thread-1" } }, null];

    render(<SettingsActivity />);

    await waitFor(() => {
      expect(reexecuteThreadsMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });

    reexecuteThreadsMock.mockClear();
    // The refresh control lives in the Threads toolbar (the tabbed Activity page
    // owns the header now, so there's no per-tab header action).
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    expect(reexecuteThreadsMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });
});
