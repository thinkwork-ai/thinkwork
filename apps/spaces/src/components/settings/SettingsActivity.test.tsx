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

import { SettingsActivity } from "./SettingsActivity";

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

  it("refreshes manually and when thread subscriptions publish updates", async () => {
    subscriptionResults = [{ onThreadUpdated: { id: "thread-1" } }, null];

    render(<SettingsActivity />);

    await waitFor(() => {
      expect(reexecuteThreadsMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });

    reexecuteThreadsMock.mockClear();
    const headerAction = usePageHeaderActionsMock.mock.calls.at(-1)?.[0]
      ?.action as React.ReactElement<{
      onClick: () => void;
      "aria-label"?: string;
    }>;
    expect(headerAction.props["aria-label"]).toBe("Refresh activity");
    headerAction.props.onClick();
    expect(reexecuteThreadsMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });
});
