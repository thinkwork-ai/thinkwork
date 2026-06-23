import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentLoopDetailContent } from "./AgentLoopDetail";
import type { AgentLoopRow } from "./agent-loop-types";

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button {...props}>{children}</button>),
  Sheet: ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsPageTitle: ({
    title,
    description,
    actions,
  }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {actions}
    </header>
  ),
  SettingsPane: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(() => cleanup());

describe("AgentLoopDetailContent", () => {
  it("renders the prompt, compact status rail, setup thread, and run thread links", () => {
    render(
      <AgentLoopDetailContent
        loop={loopFixture()}
        pendingAction={null}
        advancedOpen={false}
        onAdvancedOpenChange={vi.fn()}
        onRun={vi.fn()}
        onToggle={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Linear dispatcher" })).toBeTruthy();
    expect(
      screen.getByText(
        "Act as the Linear agent dispatcher for the Web Apps project.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Last result")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Setup thread" }).getAttribute("href"),
    ).toBe("/threads/builder-thread-1");
    const runThreadLinks = screen.getAllByRole("link", {
      name: "Open thread",
    });
    expect(runThreadLinks).toHaveLength(2);
    expect(runThreadLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/threads/run-thread-1",
      "/threads/run-thread-1",
    ]);
  });

  it("keeps advanced runtime details hidden until the inspector opens", () => {
    const onAdvancedOpenChange = vi.fn();
    const { rerender } = render(
      <AgentLoopDetailContent
        loop={loopFixture()}
        pendingAction={null}
        advancedOpen={false}
        onAdvancedOpenChange={onAdvancedOpenChange}
        onRun={vi.fn()}
        onToggle={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.queryByText("Worker and judge")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Advanced details" }));
    expect(onAdvancedOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <AgentLoopDetailContent
        loop={loopFixture()}
        pendingAction={null}
        advancedOpen={true}
        onAdvancedOpenChange={onAdvancedOpenChange}
        onRun={vi.fn()}
        onToggle={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );

    expect(screen.getByText("Worker and judge")).toBeTruthy();
    expect(screen.getByText("Evidence policy")).toBeTruthy();
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
      goalSpec: {
        objective:
          "Act as the Linear agent dispatcher for the Web Apps project.",
        completionCriteria: ["A routing decision is visible."],
      },
      workerSpec: {
        type: "agent",
        id: "agent-1",
        label: "ThinkWork Agent",
        toolHints: [],
        config: {},
      },
      judgeSpec: {
        mode: "self_check",
        criteria: ["The routing decision is grounded."],
        config: {},
      },
      loopPolicy: {
        maxIterations: 1,
        maxRuntimeMs: 1_800_000,
        maxTokens: 100000,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      evidencePolicy: {
        redactionState: "summary_only",
        retainRawEvidence: false,
        retentionDays: 30,
      },
      sourceMetadata: {
        builderThreadId: "builder-thread-1",
      },
    },
    lastRunId: "run-1",
    lastRunStatus: "completed",
    lastRunAt: "2026-06-23T13:00:00.000Z",
    lastRunSummary: {},
    acceptedRunCount: 1,
    rejectedRunCount: 0,
    escalatedRunCount: 0,
    totalCostUsdCents: 12,
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
