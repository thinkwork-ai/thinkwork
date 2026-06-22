import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopRunDetail as AgentLoopRunDetailData } from "./agent-loop-types";

const refetchMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={to}>{children}</a>,
}));

vi.mock("urql", () => ({
  useQuery: (args: unknown) => useQueryMock(args),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading</div>,
}));

vi.mock("@/components/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
  }) => (asChild ? <>{children}</> : <button>{children}</button>),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { AgentLoopRunDetail } from "./AgentLoopRunDetail";

function run(
  overrides: Partial<AgentLoopRunDetailData> = {},
): AgentLoopRunDetailData {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    agentLoopId: "loop-1",
    agentLoop: { id: "loop-1", name: "Weekly Agent Check-In", slug: "weekly" },
    agentLoopVersionId: "version-1",
    agentLoopVersion: {
      id: "version-1",
      versionNumber: 1,
      versionStatus: "active",
      triggerSpec: {},
      goalSpec: {},
      workerSpec: {},
      judgeSpec: {},
      loopPolicy: {},
      evidencePolicy: {},
    },
    status: "waiting_for_human",
    triggerFamily: "manual",
    triggerSource: "manual_run",
    scheduledJobId: null,
    actorType: "user",
    actorId: "user-1",
    idempotencyKey: null,
    correlationId: "corr-1",
    currentIteration: 1,
    terminalReason: null,
    policySnapshot: { maxIterations: 1 },
    inputSummary: { source: "settings" },
    outputSummary: null,
    startedAt: "2026-06-22T12:00:00.000Z",
    finishedAt: null,
    lastEventAt: "2026-06-22T12:01:00.000Z",
    errorCode: null,
    errorMessage: null,
    totalCostUsdCents: 42,
    iterations: [
      {
        id: "iteration-1",
        iterationNumber: 1,
        status: "waiting_for_human",
        goalModeAction: "start",
        agentWakeupRequestId: "wakeup-1",
        threadTurnId: "thread-turn-1",
        inputSummary: {},
        outputSummary: {},
        startedAt: "2026-06-22T12:00:00.000Z",
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        totalCostUsdCents: 42,
        judgments: [],
        evidence: [],
        createdAt: "2026-06-22T12:00:00.000Z",
        updatedAt: "2026-06-22T12:01:00.000Z",
      },
    ],
    judgments: [
      {
        id: "judgment-1",
        agentLoopIterationId: "iteration-1",
        judgeMode: "human_approval",
        outcome: "needs_human_approval",
        confidence: 80,
        rationale: "Needs operator approval.",
        terminalReason: "human_approval_required",
        structuredOutput: { needsApproval: true },
        createdAt: "2026-06-22T12:01:00.000Z",
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        evidenceType: "thread_turn",
        sourceSystem: "thinkwork",
        sourceId: "thread-turn-1",
        uri: null,
        summary: { title: "Turn summary" },
        redactionState: "summary_only",
        sensitivity: null,
        retentionExpiresAt: null,
        createdAt: "2026-06-22T12:01:00.000Z",
      },
    ],
    createdAt: "2026-06-22T12:00:00.000Z",
    updatedAt: "2026-06-22T12:01:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  useQueryMock.mockReset();
  refetchMock.mockReset();
  useQueryMock.mockReturnValue([
    { data: { agentLoopRun: run() }, fetching: false },
    refetchMock,
  ]);
});

afterEach(() => cleanup());

describe("AgentLoopRunDetail", () => {
  it("shows human approval state without approval controls", () => {
    render(<AgentLoopRunDetail agentLoopId="loop-1" runId="run-1" />);

    expect(screen.getByText("Waiting for human approval")).toBeTruthy();
    expect(screen.getByText("Human Approval")).toBeTruthy();
    expect(screen.getByText("Needs Human Approval")).toBeTruthy();
    expect(screen.getByText("Evidence")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/i })).toBeNull();
  });
});
