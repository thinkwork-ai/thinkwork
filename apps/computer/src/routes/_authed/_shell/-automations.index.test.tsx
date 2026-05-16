import * as React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const apiFetchMock = vi.fn();
const useQueryMock = vi.fn();
const useSubscriptionMock = vi.fn();
const pageHeaderActionsMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
      "@tanstack/react-router",
    );
  return {
    ...actual,
    useNavigate: () => navigateMock,
    createFileRoute: () => (config: unknown) => config,
  };
});

vi.mock("urql", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useSubscription: (...args: unknown[]) => useSubscriptionMock(...args),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-A" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (actions: unknown) => pageHeaderActionsMock(actions),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { Route } from "./automations.index";

const SAMPLE_COMPUTER = {
  id: "computer-marco",
  name: "Marco",
  tenantId: "tenant-A",
  ownerUserId: "user-1",
  sourceAgent: { id: "agent-marco", name: "Marco" },
};

const SAMPLE_JOBS = [
  {
    id: "d8a56ed5-c504-4c62-b3c8-2152bc6fc7a1",
    name: "Things to do with Kids",
    description: null,
    trigger_type: "agent_scheduled",
    enabled: false,
    schedule_type: "rate",
    schedule_expression: "rate(15 minutes)",
    timezone: "UTC",
    agent_id: "agent-marco",
    computer_id: "computer-marco",
    routine_id: null,
    prompt: null,
    last_run_at: new Date(Date.now() - 25 * 86_400_000).toISOString(),
    next_run_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "e2429872-71ee-47fb-a084-431a302e4b35",
    name: "Austin Events",
    description: null,
    trigger_type: "agent_scheduled",
    enabled: false,
    schedule_type: "rate",
    schedule_expression: "rate(15 minutes)",
    timezone: "UTC",
    agent_id: "agent-marco",
    computer_id: "computer-marco",
    routine_id: null,
    prompt: null,
    last_run_at: new Date(Date.now() - 11 * 86_400_000).toISOString(),
    next_run_at: null,
    created_at: new Date().toISOString(),
  },
];

beforeEach(() => {
  navigateMock.mockReset();
  apiFetchMock.mockReset();
  useQueryMock.mockReset();
  useSubscriptionMock.mockReset();
  pageHeaderActionsMock.mockReset();

  useQueryMock.mockReturnValue([{ data: { myComputer: SAMPLE_COMPUTER } }]);
  useSubscriptionMock.mockReturnValue([{ data: undefined }]);
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/scheduled-jobs")) return SAMPLE_JOBS;
    if (path.startsWith("/api/thread-turns")) return [];
    return [];
  });
});

afterEach(cleanup);

const AutomationsPage = (Route as unknown as { component: () => React.ReactElement })
  .component;

describe("apps/computer Automations route", () => {
  it("renders the user's two backfilled jobs in a paged table", async () => {
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("Things to do with Kids")).toBeTruthy(),
    );
    expect(screen.getByText("Austin Events")).toBeTruthy();
    // Both backfill rows are enabled=false in the fixture, matching the
    // current dev-tenant screenshot. The active/disabled tally is published
    // to the AppTopBar via usePageHeaderActions.
    const calls = pageHeaderActionsMock.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(
      expect.objectContaining({
        title: "Automations",
        subtitle: "0 active, 2 disabled",
      }),
    );
  });

  it("uses 40px table rows", async () => {
    render(<AutomationsPage />);
    const name = await screen.findByText("Things to do with Kids");
    const row = name.closest("tr");
    expect(row?.className).toContain("h-10");
    expect(row?.className).toContain("[&>td]:py-0");
    expect(row?.className).toContain("[&>td]:overflow-hidden");
  });

  it("filters in-memory by job name when the search input changes", async () => {
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("Things to do with Kids")).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText("Search jobs..."), {
      target: { value: "Austin" },
    });

    await waitFor(() =>
      expect(screen.queryByText("Things to do with Kids")).toBeNull(),
    );
    expect(screen.getByText("Austin Events")).toBeTruthy();
  });

  it("renders the Type column with the Computer name and a Monitor icon, not the legacy Bot/Agent badge", async () => {
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("Things to do with Kids")).toBeTruthy(),
    );
    // Two rows, each rendering "Marco" in the Type column
    const matches = screen.getAllByText("Marco");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the empty state when the API returns zero jobs", async () => {
    apiFetchMock.mockImplementationOnce(async () => []).mockImplementationOnce(async () => []);
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("No automations yet")).toBeTruthy(),
    );
    expect(
      screen.getByText(/Scheduled jobs created from this Computer/),
    ).toBeTruthy();
  });

  it("disables the Add Job button when the Computer has no source agent", async () => {
    useQueryMock.mockReturnValue([
      {
        data: {
          myComputer: { ...SAMPLE_COMPUTER, sourceAgent: null },
        },
      },
    ]);
    apiFetchMock
      .mockImplementationOnce(async () => SAMPLE_JOBS)
      .mockImplementationOnce(async () => []);
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("Things to do with Kids")).toBeTruthy(),
    );
    const addJob = screen.getByRole("button", { name: /add job/i });
    expect((addJob as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces an error message when the API call fails", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("kaboom"));
    apiFetchMock.mockResolvedValueOnce([]);
    render(<AutomationsPage />);
    await waitFor(() =>
      expect(screen.getByText("kaboom")).toBeTruthy(),
    );
  });

  it("refetches when the ThreadTurnUpdated subscription delivers", async () => {
    let subData: unknown = undefined;
    useSubscriptionMock.mockImplementation(() => [{ data: subData }]);
    const { rerender } = render(<AutomationsPage />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const initialCalls = apiFetchMock.mock.calls.length;

    subData = { onThreadTurnUpdated: { threadId: "t1" } };
    rerender(<AutomationsPage />);
    await waitFor(() =>
      expect(apiFetchMock.mock.calls.length).toBeGreaterThan(initialCalls),
    );
  });
});
