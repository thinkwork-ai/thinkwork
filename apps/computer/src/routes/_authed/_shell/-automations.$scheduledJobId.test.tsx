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
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
    createFileRoute: () => (config: { component: unknown }) => ({
      ...config,
      useParams: () => ({ scheduledJobId: "job-1" }),
    }),
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

import { Route } from "./automations.$scheduledJobId";

const SAMPLE_JOB = {
  id: "job-1",
  name: "Things to do with Kids",
  description: null,
  trigger_type: "agent_scheduled",
  enabled: true,
  schedule_type: "rate",
  schedule_expression: "rate(15 minutes)",
  timezone: "UTC",
  agent_id: "agent-marco",
  computer_id: "computer-marco",
  routine_id: null,
  prompt: "Find weekend things to do with the kids in Austin",
  last_run_at: null,
  next_run_at: null,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  navigateMock.mockReset();
  apiFetchMock.mockReset();
  useQueryMock.mockReset();
  useSubscriptionMock.mockReset();
  pageHeaderActionsMock.mockReset();

  useQueryMock.mockReturnValue([
    {
      data: {
        assignedComputers: [
          {
            id: "computer-marco",
            name: "Marco",
            tenantId: "tenant-A",
            sourceAgent: { id: "agent-marco", name: "Marco" },
          },
        ],
      },
    },
  ]);
  useSubscriptionMock.mockReturnValue([{ data: undefined }]);
});

afterEach(cleanup);

const ScheduledJobDetailPage = (
  Route as unknown as { component: () => React.ReactElement }
).component;

describe("apps/computer scheduled-job detail route", () => {
  it("renders job header + run history when both fetches succeed", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/scheduled-jobs/job-1")) return SAMPLE_JOB;
      if (path.startsWith("/api/thread-turns")) return [];
      return [];
    });

    render(<ScheduledJobDetailPage />);

    await waitFor(() =>
      expect(screen.getByText(/Find weekend things/)).toBeTruthy(),
    );
    expect(screen.getByText("No runs yet.")).toBeTruthy();
    expect(
      screen.getByText("Find weekend things to do with the kids in Austin"),
    ).toBeTruthy();
  });

  it("renders a full-page error when the job fetch fails (404 case)", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/scheduled-jobs/job-1"))
        throw new Error("Trigger not found");
      return [];
    });

    render(<ScheduledJobDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("Trigger not found")).toBeTruthy(),
    );
    // Header buttons (Disable / Edit / Fire / Delete) should not be rendered
    expect(screen.queryByRole("button", { name: /Disable/i })).toBeNull();
  });

  it("renders an inline runs error with a Retry button when only runs fetch fails", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/scheduled-jobs/job-1")) return SAMPLE_JOB;
      if (path.startsWith("/api/thread-turns")) throw new Error("runs boom");
      return [];
    });

    render(<ScheduledJobDetailPage />);

    await waitFor(() =>
      expect(screen.getByText(/Find weekend things/)).toBeTruthy(),
    );
    expect(
      screen.getByText(/Failed to load run history: runs boom/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
    // Header controls remain enabled — partial failure does not collapse the page
    expect(screen.getByRole("button", { name: /Disable/i })).toBeTruthy();
  });

  it("PUTs enabled toggle + refetches the job", async () => {
    apiFetchMock.mockImplementation(
      async (path: string, opts: { method?: string } = {}) => {
        if (
          path.startsWith("/api/scheduled-jobs/job-1") &&
          opts.method === "PUT"
        ) {
          return SAMPLE_JOB;
        }
        if (path.startsWith("/api/scheduled-jobs/job-1")) return SAMPLE_JOB;
        if (path.startsWith("/api/thread-turns")) return [];
        return [];
      },
    );

    render(<ScheduledJobDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/Find weekend things/)).toBeTruthy(),
    );

    const before = apiFetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Disable/i }));

    await waitFor(() =>
      expect(apiFetchMock.mock.calls.length).toBeGreaterThan(before),
    );
    const putCall = apiFetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].startsWith("/api/scheduled-jobs/job-1") &&
        (c[1] as { method?: string } | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse((putCall![1] as { body: string }).body)).toEqual({
      enabled: false,
    });
  });

  it("Trigger Now POSTs to /:id/fire and does not collapse the page on success", async () => {
    apiFetchMock.mockImplementation(
      async (path: string, opts: { method?: string } = {}) => {
        if (
          path.startsWith("/api/scheduled-jobs/job-1/fire") &&
          opts.method === "POST"
        ) {
          return { ok: true };
        }
        if (path.startsWith("/api/scheduled-jobs/job-1")) return SAMPLE_JOB;
        if (path.startsWith("/api/thread-turns")) return [];
        return [];
      },
    );

    render(<ScheduledJobDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/Find weekend things/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Trigger Now/ }));

    await waitFor(() => {
      const fireCall = apiFetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].startsWith("/api/scheduled-jobs/job-1/fire"),
      );
      expect(fireCall).toBeTruthy();
    });
    expect(screen.getByText(/Find weekend things/)).toBeTruthy();
  });

  it("subscription delivery refetches run history (not the job header)", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/scheduled-jobs/job-1")) return SAMPLE_JOB;
      if (path.startsWith("/api/thread-turns")) return [];
      return [];
    });

    let subData: unknown = undefined;
    useSubscriptionMock.mockImplementation(() => [{ data: subData }]);

    const { rerender } = render(<ScheduledJobDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/Find weekend things/)).toBeTruthy(),
    );
    const initialRunsCalls = apiFetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/thread-turns"),
    ).length;

    subData = { onThreadTurnUpdated: { threadId: "t1" } };
    rerender(<ScheduledJobDetailPage />);

    await waitFor(() => {
      const runsCalls = apiFetchMock.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].startsWith("/api/thread-turns"),
      ).length;
      expect(runsCalls).toBeGreaterThan(initialRunsCalls);
    });
  });
});
