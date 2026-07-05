import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentLoopDetailContent } from "./AgentLoopDetail";
import type { AgentLoopRow } from "./agent-loop-types";

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button {...props}>{children}</button>),
  Tabs: ({
    children,
    defaultValue: _defaultValue,
    ...props
  }: {
    children: React.ReactNode;
    defaultValue?: string;
  }) => <div {...props}>{children}</div>,
  TabsContent: ({
    children,
    value: _value,
    ...props
  }: {
    children: React.ReactNode;
    value?: string;
  }) => <div {...props}>{children}</div>,
  TabsList: ({
    children,
    variant: _variant,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) => (
    <div {...props}>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value?: string }) => (
    <button {...props} type="button" data-value={value}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsPageTitle: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  SettingsPane: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(() => cleanup());

describe("AgentLoopDetailContent", () => {
  it("renders R1 fields (trigger, target, run-as, space) plus instructions and the runs table", () => {
    render(
      <AgentLoopDetailContent
        loop={loopFixture()}
        pendingAction={null}
        spaceOptions={[{ id: "space-1", name: "Customer" }]}
        memberOptions={[{ id: "user-9", label: "Ada" }]}
        onRun={vi.fn()}
        onToggle={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Linear dispatcher" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Definition" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(
      screen.getByText(
        "Act as the Linear agent dispatcher for the Web Apps project.",
      ),
    ).toBeTruthy();
    // Status-rail R1 fields.
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.getByText("Agent thread")).toBeTruthy();
    expect(screen.getByText("Run as")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Space")).toBeTruthy();
    expect(screen.getByText("Customer")).toBeTruthy();
    // Runs table.
    expect(screen.getByText("Recent Runs")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Started" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeTruthy();
  });

  it("does not render legacy judge/evidence runtime detail", () => {
    render(
      <AgentLoopDetailContent
        loop={loopFixture()}
        pendingAction={null}
        onRun={vi.fn()}
        onToggle={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.queryByText("Worker and judge")).toBeNull();
    expect(screen.queryByText("Evidence policy")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Advanced details" }),
    ).toBeNull();
  });
});

function loopFixture(): AgentLoopRow {
  return {
    id: "loop-1",
    tenantId: "tenant-1",
    name: "Linear dispatcher",
    slug: "linear-dispatcher",
    description: "Route Linear work.",
    lifecycleStatus: "active",
    enabled: true,
    runAsUserId: "user-9",
    spaceId: "space-1",
    primaryTriggerFamily: "schedule",
    currentVersionId: "version-1",
    currentVersionNumber: 3,
    currentVersion: {
      id: "version-1",
      versionNumber: 3,
      versionStatus: "active",
      triggerSpec: {
        family: "schedule",
        enabled: true,
        config: { scheduleExpression: "rate(5 minutes)", timezone: "UTC" },
      },
      targetSpec: {
        kind: "agent_thread",
        agentThread: {
          instructions:
            "Act as the Linear agent dispatcher for the Web Apps project.",
          workerId: "agent-1",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      },
      sourceMetadata: {},
    },
    lastRunId: "run-1",
    lastRunStatus: "completed",
    lastRunAt: "2026-06-23T13:00:00.000Z",
    lastRunSummary: {},
    runs: [
      {
        id: "run-1",
        status: "completed",
        threadId: "run-thread-1",
        triggerFamily: "manual",
        currentIteration: 1,
        startedAt: "2026-06-23T13:00:00.000Z",
        finishedAt: "2026-06-23T13:01:00.000Z",
        totalCostUsdCents: 12,
        createdAt: "2026-06-23T13:00:00.000Z",
      },
    ],
    createdAt: "2026-06-23T12:00:00.000Z",
    updatedAt: "2026-06-23T13:00:00.000Z",
  };
}
