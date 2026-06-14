import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledJobRow } from "@/routes/_authed/_shell/-automations.utils";

const navigateMock = vi.fn();
const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsTablePane: ({
    children,
    toolbar,
    title,
  }: {
    children: React.ReactNode;
    toolbar?: React.ReactNode;
    title?: string;
  }) => (
    <section>
      <h1>{title}</h1>
      <div>{toolbar}</div>
      {children}
    </section>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  DataTable: ({
    data,
    filterValue,
    emptyState,
    onRowClick,
  }: {
    data: ScheduledJobRow[];
    filterValue?: string;
    emptyState?: React.ReactNode;
    onRowClick?: (row: ScheduledJobRow) => void;
  }) => {
    const rows = filterValue
      ? data.filter((row) =>
          row.name.toLowerCase().includes(filterValue.toLowerCase()),
        )
      : data;
    return (
      <div data-testid="automations-table-view">
        {rows.length
          ? rows.map((row) => (
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
    );
  },
  DisplayViewControl: ({
    modes,
    onStateChange,
    state,
  }: {
    modes: Array<{ value: "table" | "list"; label: string }>;
    state: { view: "table" | "list" };
    onStateChange: (state: unknown) => void;
  }) => (
    <div data-testid="automation-display-control">
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
    groups: Array<{ id: string; label: string; rows: ScheduledJobRow[] }>;
    renderRow: (row: ScheduledJobRow) => React.ReactNode;
    emptyState?: React.ReactNode;
  }) => (
    <div data-testid="automations-list-view">
      {groups.some((group) => group.rows.length)
        ? groups.map((group) => (
            <section key={group.id}>
              <h2>
                {group.label} {group.rows.length}
              </h2>
              {group.rows.map((row) => (
                <div key={row.id}>{renderRow(row)}</div>
              ))}
            </section>
          ))
        : emptyState}
    </div>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

import {
  AUTOMATIONS_DISPLAY_CONFIG,
  SettingsAutomations,
} from "./SettingsAutomations";

function job(overrides: Partial<ScheduledJobRow> = {}): ScheduledJobRow {
  return {
    id: "job-1",
    name: "Daily digest",
    description: "Summarize the day",
    trigger_type: "agent_scheduled",
    enabled: true,
    schedule_type: null,
    schedule_expression: "rate(1 day)",
    timezone: "UTC",
    agent_id: "agent-1",
    computer_id: null,
    routine_id: null,
    prompt: null,
    eb_schedule_name: null,
    last_run_at: "2026-06-14T12:00:00.000Z",
    next_run_at: null,
    created_at: "2026-06-01T12:00:00.000Z",
    created_by_type: "agent",
    created_by_id: "agent-1",
    ...overrides,
  };
}

beforeEach(() => {
  navigateMock.mockReset();
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue([
    job(),
    job({
      id: "job-2",
      name: "Weekly cleanup",
      enabled: false,
      trigger_type: "routine_schedule",
    }),
  ]);
});

afterEach(() => {
  cleanup();
});

describe("SettingsAutomations", () => {
  it("keeps search filtering when switching from table to list", async () => {
    const onDisplayStateChange = vi.fn();

    const view = render(
      <SettingsAutomations
        displayState={AUTOMATIONS_DISPLAY_CONFIG.defaults}
        onDisplayStateChange={onDisplayStateChange}
      />,
    );

    await screen.findByText("Daily digest");
    fireEvent.change(screen.getByPlaceholderText("Search automations…"), {
      target: { value: "weekly" },
    });

    expect(screen.queryByText("Daily digest")).toBeNull();
    expect(screen.getByText("Weekly cleanup")).toBeTruthy();

    fireEvent.click(screen.getByText("List"));
    expect(onDisplayStateChange).toHaveBeenCalledWith({
      ...AUTOMATIONS_DISPLAY_CONFIG.defaults,
      view: "list",
    });

    view.rerender(
      <SettingsAutomations
        displayState={{ ...AUTOMATIONS_DISPLAY_CONFIG.defaults, view: "list" }}
        onDisplayStateChange={onDisplayStateChange}
      />,
    );

    expect(screen.getByTestId("automations-list-view")).toBeTruthy();
    expect(screen.queryByText("Daily digest")).toBeNull();
    expect(screen.getByText("Weekly cleanup")).toBeTruthy();
  });

  it("renders only Table/List controls and opens list rows through the detail route", async () => {
    render(
      <SettingsAutomations
        displayState={{ ...AUTOMATIONS_DISPLAY_CONFIG.defaults, view: "list" }}
      />,
    );

    await screen.findByText("Daily digest");
    expect(screen.getByText("Table")).toBeTruthy();
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.queryByText("Board")).toBeNull();

    fireEvent.click(screen.getByText("Daily digest"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/automations/$scheduledJobId",
      params: { scheduledJobId: "job-1" },
      search: { view: "list" },
    });
  });
});
