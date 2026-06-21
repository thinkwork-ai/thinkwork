import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeEditor } from "./SkillTokenInput";
import { useMutation, useQuery, useSubscription } from "urql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  MyApprovedModelCatalogQuery,
  RefreshThreadProgressMutation,
  ReviewGoalMutation,
  SettingsActivityThreadTurnsQuery,
  ThreadGoalFilesQuery,
  ThreadLinkedTasksQuery,
  ThreadProgressMarkdownQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import { APPROVED_MODEL_STORAGE_KEY } from "@/lib/approved-model-selection";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import {
  SpacesThreadDetailRoute,
  deriveThreadArtifacts,
  resolveThreadArtifactSelection,
} from "./SpacesThreadDetailRoute";
import {
  clearPendingThreadStart,
  setPendingThreadStart,
} from "@/lib/pending-thread-starts";

const spacesThreadDetailRouteSource = readFileSync(
  path.join(
    process.cwd(),
    "src/components/workbench/SpacesThreadDetailRoute.tsx",
  ),
  "utf8",
);

// Follow-up composer is a contenteditable token field, not a <textarea>.
function setFollowUpText(value: string) {
  const el = screen.getByLabelText("Follow up");
  el.textContent = value;
  fireEvent.input(el);
}

const routerLocationStateMock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));
const apiFetchMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
    useClient: vi.fn(() => ({
      mutation: vi.fn(),
      subscription: vi.fn(),
    })),
  };
});

vi.mock("@/components/apps/InlineAppletEmbed", () => ({
  InlineAppletEmbed: ({ appId }: { appId: string }) => (
    <div data-testid="inline-applet-embed-stub" data-app-id={appId} />
  ),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => (
      <a href={params?.id ? to.replace("$id", params.id) : to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
      select({ location: { state: routerLocationStateMock.state } }),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/lib/use-computer-thread-chunks", () => ({
  useComputerThreadChunks: vi.fn(),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: apiFetchMock.apiFetch,
}));

const reexecuteThreadQuery = vi.fn();
const reexecuteLinkedTasksQuery = vi.fn();
const reexecuteProgressMarkdownQuery = vi.fn();
const reexecuteGoalFilesQuery = vi.fn();
const reexecuteTasksQuery = vi.fn();
const reexecuteThreadTurnsQuery = vi.fn();
const sendMessage = vi.fn();
const updateThreadMock = vi.fn();
const reviewGoalMock = vi.fn();
const refreshThreadProgressMock = vi.fn();
const resetStreamingChunks = vi.fn();

let threadData: unknown;
let taskData: unknown;
let eventData: unknown;
let mentionTargetsData: unknown;
let linkedTasksData: unknown;
let progressMarkdownData: unknown;
let goalFilesData: unknown;
let approvedModelsData: unknown;
let threadTurnsData: unknown;
let streamingChunks: Array<{ seq: number; text: string }> = [];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(usePageHeaderActions).mockReset();
  routerLocationStateMock.state = {};
  clearPendingThreadStart("thread-new");
  reexecuteThreadQuery.mockReset();
  reexecuteLinkedTasksQuery.mockReset();
  reexecuteProgressMarkdownQuery.mockReset();
  reexecuteGoalFilesQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  reexecuteThreadTurnsQuery.mockReset();
  sendMessage.mockReset();
  updateThreadMock.mockReset();
  reviewGoalMock.mockReset();
  refreshThreadProgressMock.mockReset();
  resetStreamingChunks.mockReset();
  apiFetchMock.apiFetch.mockReset();
  apiFetchMock.apiFetch.mockResolvedValue([]);
  window.localStorage.clear();
  streamingChunks = [];
  threadData = {
    thread: {
      id: "thread-1",
      computerId: "computer-1",
      spaceId: "space-1",
      title: "Route streaming thread",
      lifecycleStatus: "RUNNING",
      messages: {
        edges: [
          {
            node: {
              id: "message-1",
              role: "USER",
              content: "Stream this answer",
            },
          },
        ],
      },
    },
  };
  taskData = {
    computerTasks: [
      {
        id: "task-1",
        status: "RUNNING",
        input: { source: "chat_message" },
        output: null,
        error: null,
        claimedAt: "2026-05-09T08:00:00Z",
        completedAt: null,
        createdAt: "2026-05-09T08:00:00Z",
      },
    ],
  };
  eventData = { computerEvents: [] };
  mentionTargetsData = { threadMentionTargets: [] };
  linkedTasksData = { threadLinkedTasks: [] };
  progressMarkdownData = { threadProgressMarkdown: null };
  goalFilesData = { threadGoalFiles: null };
  approvedModelsData = undefined;
  threadTurnsData = { threadTurns: [] };

  sendMessage.mockResolvedValue({});
  updateThreadMock.mockResolvedValue({});
  reviewGoalMock.mockResolvedValue({});
  refreshThreadProgressMock.mockResolvedValue({});
  vi.mocked(useMutation).mockImplementation((mutation) => {
    if (mutation === UpdateThreadMutation) {
      return [
        { fetching: false, stale: false, hasNext: false },
        updateThreadMock,
      ];
    }
    if (mutation === ReviewGoalMutation) {
      return [
        { fetching: false, stale: false, hasNext: false },
        reviewGoalMock,
      ];
    }
    if (mutation === RefreshThreadProgressMutation) {
      return [
        { fetching: false, stale: false, hasNext: false },
        refreshThreadProgressMock,
      ];
    }
    return [{ fetching: false, stale: false, hasNext: false }, sendMessage];
  });
  vi.mocked(useSubscription).mockReturnValue([
    { data: null, fetching: false, stale: false },
    () => {},
  ]);
  vi.mocked(useComputerThreadChunks).mockImplementation(() => ({
    chunks: streamingChunks,
    streamState: {
      parts: [],
      legacyText: "",
      status: "idle" as const,
    },
    reset: resetStreamingChunks,
  }));
  vi.mocked(useQuery).mockImplementation((options) => {
    const variables = options.variables as
      | {
          messageLimit?: number;
          threadId?: string;
          tenantId?: string;
          limit?: number;
        }
      | undefined;
    if (variables?.messageLimit) {
      return [queryState(threadData), reexecuteThreadQuery];
    }
    if (options.query === ThreadLinkedTasksQuery) {
      return [queryState(linkedTasksData), reexecuteLinkedTasksQuery];
    }
    if (options.query === ThreadProgressMarkdownQuery) {
      return [queryState(progressMarkdownData), reexecuteProgressMarkdownQuery];
    }
    if (options.query === ThreadGoalFilesQuery) {
      return [queryState(goalFilesData), reexecuteGoalFilesQuery];
    }
    if (options.query === MyApprovedModelCatalogQuery) {
      return [queryState(approvedModelsData), vi.fn()];
    }
    if (options.query === SettingsActivityThreadTurnsQuery) {
      return [queryState(threadTurnsData), reexecuteThreadTurnsQuery];
    }
    if (variables?.threadId && variables?.limit) {
      return [queryState(taskData), reexecuteTasksQuery];
    }
    if (variables?.threadId) {
      return [queryState(mentionTargetsData), vi.fn()];
    }
    if (variables?.limit) return [queryState(eventData), vi.fn()];
    return [queryState(null), vi.fn()];
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
});

describe("SpacesThreadDetailRoute", () => {
  it("renders an optimistic new-thread scaffold from the pending start registry", () => {
    threadData = null;
    taskData = { computerTasks: [] };
    setPendingThreadStart({
      threadId: "thread-new",
      title: "Fast route please",
      content: "Fast route please",
      expectAssistantResponse: true,
    });

    render(<SpacesThreadDetailRoute threadId="thread-new" />);

    expect(screen.getByText("Fast route please")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.queryByText("Thread not found")).toBeNull();
    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Fast route please",
        documentTitle: "Thread · Fast route please",
      }),
    );
  });

  it("keeps the optimistic working row after the first message persists but before the turn row exists", () => {
    threadData = {
      thread: {
        id: "thread-new",
        computerId: "computer-1",
        title: "What's my name?",
        lifecycleStatus: "RUNNING",
        messages: {
          edges: [
            {
              node: {
                id: "message-new",
                role: "USER",
                content: "What's my name?",
              },
            },
          ],
        },
      },
    };
    taskData = { computerTasks: [] };
    setPendingThreadStart({
      threadId: "thread-new",
      title: "What's my name?",
      content: "What's my name?",
      expectAssistantResponse: true,
    });

    render(<SpacesThreadDetailRoute threadId="thread-new" />);

    expect(screen.getByText("What's my name?")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
  });

  it("renders n8n bridge telemetry in the thread info drawer", () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Bridge thread",
        status: "OPEN",
        messages: { edges: [] },
      },
      n8nAgentStepRuns: [
        {
          id: "run-1",
          status: "resume_failed",
          resumeStatus: "failed",
          workflowId: "workflow-1",
          workflowName: "Fulfillment check",
          executionId: "exec-1",
          correlationId: "corr-1",
          instructionsPreview: null,
          inputPreview: null,
          outputPreview: null,
          errorMessage: "n8n callback returned 410 Gone",
          summary: null,
          links: {},
          resumeAttemptCount: 1,
          lastResumeHttpStatus: 410,
          lastResumeError: null,
          expiresAt: "2026-06-20T12:30:00.000Z",
          updatedAt: "2026-06-20T12:00:00.000Z",
        },
      ],
    };
    taskData = { computerTasks: [] };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));

    expect(screen.getByText("n8n agent steps")).toBeTruthy();
    expect(screen.getByText("Fulfillment check")).toBeTruthy();
    expect(screen.getAllByText("resume failed").length).toBeGreaterThan(0);
    expect(screen.getByText("n8n callback returned 410 Gone")).toBeTruthy();
    expect(screen.queryByText(/webhook-waiting/i)).toBeNull();
  });

  it("derives thread artifacts in message order and deduplicates repeated ids", () => {
    const artifacts = deriveThreadArtifacts({
      id: "thread-1",
      messages: [
        {
          id: "message-1",
          role: "USER",
          content: "Build the first app",
        },
        {
          id: "message-2",
          role: "ASSISTANT",
          durableArtifact: {
            id: "artifact-a",
            title: "First artifact",
            type: "DATA_VIEW",
          },
        },
        {
          id: "message-3",
          role: "ASSISTANT",
          durableArtifact: {
            id: "artifact-b",
            title: "Second artifact",
            type: "APPLET",
          },
        },
        {
          id: "message-4",
          role: "ASSISTANT",
          durableArtifact: {
            id: "artifact-a",
            title: "First artifact duplicate",
            type: "DATA_VIEW",
          },
        },
      ],
    });

    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      "artifact-a",
      "artifact-b",
    ]);
    expect(artifacts[0].title).toBe("First artifact");
  });

  it("keeps a valid selected artifact and otherwise falls back to the latest artifact", () => {
    const artifacts = [
      { id: "artifact-a", title: "First artifact" },
      { id: "artifact-b", title: "Second artifact" },
    ];

    expect(resolveThreadArtifactSelection(artifacts, "artifact-a")).toBe(
      "artifact-a",
    );
    expect(resolveThreadArtifactSelection(artifacts, "missing")).toBe(
      "artifact-b",
    );
    expect(resolveThreadArtifactSelection(artifacts, null)).toBe("artifact-b");
    expect(resolveThreadArtifactSelection([], "artifact-a")).toBeNull();
  });

  it("does not register a header back button by default", () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ backHref: expect.any(String) }),
    );
  });

  it("uses supplied Settings Activity breadcrumbs for hosted thread detail", () => {
    render(
      <SpacesThreadDetailRoute
        threadId="thread-1"
        breadcrumbParents={[
          { label: "Activity", href: "/settings/activity" },
          {
            label: "May 31",
            href: "/settings/activity",
            search: { day: "2026-05-31" },
          },
        ]}
      />,
    );

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        breadcrumbs: [
          { label: "Activity", href: "/settings/activity" },
          {
            label: "May 31",
            href: "/settings/activity",
            search: { day: "2026-05-31" },
          },
          { label: "Route streaming thread" },
        ],
      }),
    );
  });

  it("registers an artifact side-panel header action when the thread has artifacts", () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Artifact thread",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Build a dashboard",
              },
            },
            {
              node: {
                id: "message-2",
                role: "ASSISTANT",
                content: "I created a dashboard app.",
                durableArtifact: {
                  id: "artifact_123",
                  title: "CRM pipeline risk app",
                  type: "DATA_VIEW",
                  summary: "Stale opportunity analysis",
                  metadata: { kind: "research_dashboard" },
                },
              },
            },
          ],
        },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.anything(),
        titleTrailing: expect.anything(),
        actionKey: expect.stringContaining(
          ":1:artifact_123:info-closed:closed",
        ),
      }),
    );
  });

  it("anchors the thread actions menu next to the title", () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderTitleTrailing();

    expect(screen.getByRole("button", { name: "Thread actions" })).toBeTruthy();
  });

  it("refreshes generated progress and refetches thread data for a manual desktop refresh event", async () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    window.dispatchEvent(new CustomEvent("thinkwork:desktop-refresh"));

    await waitFor(() => {
      expect(refreshThreadProgressMock).toHaveBeenCalledWith({
        input: { tenantId: "tenant-1", threadId: "thread-1" },
      });
    });
    await waitFor(() => {
      expect(reexecuteThreadQuery).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
    expect(reexecuteTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteLinkedTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteProgressMarkdownQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteGoalFilesQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("uses muted desktop chrome styling for thread header icon actions", () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Artifact thread",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "ASSISTANT",
                content: "I created a dashboard app.",
                durableArtifact: {
                  id: "artifact_123",
                  title: "CRM pipeline risk app",
                  type: "DATA_VIEW",
                },
              },
            },
          ],
        },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();

    expect(
      screen.getByRole("button", { name: "Open thread info" }).className,
    ).toContain("text-muted-foreground/70");
    expect(
      screen.getByRole("button", { name: "Open artifact side panel" })
        .className,
    ).toContain("text-muted-foreground/70");
  });

  it("does not refetch the full thread for turn-only status updates", () => {
    let subscriptionCall = 0;
    vi.mocked(useSubscription).mockImplementation(() => {
      subscriptionCall += 1;
      if (subscriptionCall === 1) {
        return [
          {
            data: {
              onThreadTurnUpdated: {
                threadId: "thread-1",
              },
            },
            fetching: false,
            stale: false,
          },
          () => {},
        ];
      }
      return [{ data: null, fetching: false, stale: false }, () => {}];
    });

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(reexecuteThreadQuery).not.toHaveBeenCalled();
    expect(reexecuteTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("uses the navigated thread title while the route thread is loading", () => {
    threadData = {
      thread: {
        id: "previous-thread",
        computerId: "computer-1",
        title: "Previous thread title",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Old thread body",
              },
            },
          ],
        },
      },
    };
    routerLocationStateMock.state = {
      threadTitleFallback: {
        threadId: "next-thread",
        title: "Side nav title",
      },
    };

    render(<SpacesThreadDetailRoute threadId="next-thread" />);

    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Previous thread title")).toBeNull();
    expect(screen.queryByText("Old thread body")).toBeNull();
    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Side nav title",
        documentTitle: "Thread · Side nav title",
        titleContent: undefined,
      }),
    );
  });

  it("shows Loading as the header title without a navigated title", () => {
    threadData = {
      thread: {
        id: "previous-thread",
        computerId: "computer-1",
        title: "Previous thread title",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Old thread body",
              },
            },
          ],
        },
      },
    };

    render(<SpacesThreadDetailRoute threadId="next-thread" />);

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Loading...",
        documentTitle: "Thread · Loading...",
        titleContent: undefined,
      }),
    );
  });

  it("passes live AppSync chunks into the thread detail while a turn is running", () => {
    streamingChunks = [{ seq: 1, text: "Streaming through the route" }];
    eventData = {
      computerEvents: [
        {
          id: "event-1",
          taskId: "task-1",
          eventType: "browser_automation_unavailable",
          level: "WARN",
          payload: { reason: "nova_act_api_key_missing" },
          createdAt: "2026-05-09T08:01:00Z",
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(screen.getByText("Streaming through the route")).toBeTruthy();
    const activity = screen.getAllByLabelText("Turn activity")[0];
    fireEvent.click(within(activity).getByRole("button"));
    expect(screen.getByText("Browser unavailable")).toBeTruthy();
    expect(screen.getByLabelText("ThinkWork is typing")).toBeTruthy();
    expect(screen.queryByLabelText("Processing request")).toBeNull();
  });

  it("clears live chunks after the durable assistant message is visible", async () => {
    streamingChunks = [{ seq: 1, text: "Transient streamed text" }];
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Route streaming thread",
        lifecycleStatus: "COMPLETED",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Stream this answer",
              },
            },
            {
              node: {
                id: "message-2",
                role: "ASSISTANT",
                content: "Durable assistant answer",
              },
            },
          ],
        },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(screen.getByText("Durable assistant answer")).toBeTruthy();
    expect(screen.queryByText("Transient streamed text")).toBeNull();
    await waitFor(() => {
      expect(resetStreamingChunks).toHaveBeenCalled();
    });
  });

  it("renders live data-genui chunks from thread turn step activity", async () => {
    const part = createTaskReviewGenUIFixture();
    taskData = { computerTasks: [] };
    threadTurnsData = {
      threadTurns: [
        {
          id: "turn-with-genui",
          threadId: "thread-1",
          invocationSource: "chat_message",
          status: "running",
          startedAt: "2026-06-20T12:00:00.000Z",
        },
      ],
    };
    let subscriptionCall = 0;
    vi.mocked(useSubscription).mockImplementation(() => {
      subscriptionCall += 1;
      if (subscriptionCall === 4) {
        return [
          {
            data: {
              onThreadTurnStep: {
                runId: "turn-with-genui",
                seq: 7,
                eventType: "ui_message_chunk",
                level: "info",
                payload: JSON.stringify({
                  kind: "thread_genui.ui_message_chunk",
                  chunk: part,
                }),
                createdAt: "2026-06-20T12:00:01.000Z",
              },
            },
            fetching: false,
            stale: false,
          },
          () => {},
        ];
      }
      return [{ data: null, fetching: false, stale: false }, () => {}];
    });

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByText("Review onboarding task")).toBeTruthy();
    });
    expect(screen.queryByText("UI Message Chunk")).toBeNull();
  });

  it("reconstructs goal-run cards from persisted thread turn evidence", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        title: "Goal thread",
        lifecycleStatus: "COMPLETED",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "/goal Prepare launch report",
              },
            },
            {
              node: {
                id: "message-2",
                role: "ASSISTANT",
                content: "Launch report is ready.",
              },
            },
          ],
        },
      },
    };
    threadTurnsData = {
      threadTurns: [
        {
          id: "turn-goal",
          threadId: "thread-1",
          invocationSource: "chat_message",
          status: "succeeded",
          startedAt: "2026-06-21T20:00:00.000Z",
          finishedAt: "2026-06-21T20:01:00.000Z",
          resultJson: {
            response: "Launch report is ready.",
            goal_run: {
              source: "pi_goal",
              status: "complete",
              objective: "Prepare launch report",
              completion_summary: "Launch report is complete.",
              tokens_used: 28000,
              token_budget: 125000,
            },
          },
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Turn activity")).toBeTruthy();
    });
    fireEvent.click(
      within(screen.getByLabelText("Turn activity")).getByRole("button"),
    );

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getAllByText("Prepare launch report").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Launch report is complete.")).toBeTruthy();
  });

  it("renders native onboarding Progress in the Info Panel and task clicks prefill the composer", async () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Acme onboarding",
        status: "OPEN",
        metadata: {
          customerOnboarding: {
            workflow: "customer_onboarding",
            facts: {
              companyName: "Acme Inc",
              taxExempt: true,
              creditTermsRequested: false,
            },
          },
        },
        messages: { edges: [] },
      },
    };
    linkedTasksData = {
      threadLinkedTasks: [
        {
          id: "linked-1",
          provider: "THINKWORK",
          title: "Stale linked task title",
          required: true,
          status: "NOT_APPLICABLE",
          syncStatus: "SYNCED",
        },
      ],
    };
    progressMarkdownData = {
      threadProgressMarkdown: {
        threadId: "thread-1",
        key: "tenants/acme/threads/thread-1/PROGRESS.md",
        content: [
          "# PROGRESS",
          "",
          "Goal: Complete customer onboarding for E2E Progress MD 20260525201201 Co.",
          "",
          "## Tasks",
          "| Task | Status | Owner | Required | Blocker/Notes |",
          "| --- | --- | --- | --- | --- |",
          "| Get contract signed - E2E Progress MD 20260525201201 Co | Completed | Sales | Yes | signed package received |",
        ].join("\n"),
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));

    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("Get contract signed")).toBeTruthy();
    expect(
      screen.queryByText(
        "Get contract signed - E2E Progress MD 20260525201201 Co",
      ),
    ).toBeNull();
    // Owner + status now render as a sublabel under the task title (Progress card style).
    expect(screen.getByText("Sales · Completed")).toBeTruthy();
    expect(screen.queryByText("signed package received")).toBeNull();
    expect(screen.queryByText("Stale linked task title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));

    await waitFor(() => {
      expect(refreshThreadProgressMock).toHaveBeenCalledWith({
        input: { tenantId: "tenant-1", threadId: "thread-1" },
      });
    });
    await waitFor(() => {
      expect(reexecuteProgressMarkdownQuery).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
    expect(reexecuteLinkedTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteGoalFilesQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });

    const originalFocus = HTMLTextAreaElement.prototype.focus;
    let focusAttempts = 0;
    const focusSpy = vi
      .spyOn(HTMLTextAreaElement.prototype, "focus")
      .mockImplementation(function focusWithDroppedFirstAttempt(
        this: HTMLTextAreaElement,
        options?: FocusOptions,
      ) {
        focusAttempts += 1;
        if (focusAttempts === 1) return;
        return originalFocus.call(this, options);
      });

    try {
      fireEvent.click(
        screen.getByRole("button", { name: "Update Get contract signed" }),
      );

      expect(serializeEditor(screen.getByLabelText("Follow up"))).toBe(
        "Get contract signed: ",
      );
      // The composer ends up focused even though the first focus attempt was
      // suppressed (disabled→enabled retry) — the point of this test. The
      // contenteditable token field focuses via the editor handle, so we assert
      // the end state (focused + prefilled) rather than the textarea-era
      // focus-call count.
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("Follow up"));
      });
    } finally {
      focusSpy.mockRestore();
    }
  });

  it("sends clicked onboarding task completion commands with timestamped customer suffixes intact", async () => {
    const title =
      "Send and receive DocuSign package - AgentCore workspace shape 2026-06-01T08:05:31.708Z";
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "AgentCore workspace shape onboarding",
        status: "OPEN",
        metadata: {
          customerOnboarding: {
            workflow: "customer_onboarding",
          },
        },
        messages: { edges: [] },
      },
    };
    linkedTasksData = {
      threadLinkedTasks: [
        {
          id: "linked-1",
          provider: "THINKWORK",
          title,
          required: true,
          status: "TODO",
          syncStatus: "SYNCED",
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));
    fireEvent.click(screen.getByRole("button", { name: `Update ${title}` }));
    setFollowUpText(`${title}: done`);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: `${title}: done`,
        },
      });
    });
  });

  it("completes an onboarding Thread after required checklist rows are complete", async () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Acme onboarding",
        status: "OPEN",
        metadata: {
          customerOnboarding: { workflow: "customer_onboarding" },
        },
        messages: { edges: [] },
      },
    };
    linkedTasksData = {
      threadLinkedTasks: [
        {
          id: "linked-1",
          provider: "THINKWORK",
          title: "Get contract signed",
          required: true,
          status: "COMPLETED",
          syncStatus: "SYNCED",
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as completed" }));

    await waitFor(() => {
      expect(updateThreadMock).toHaveBeenCalledWith({
        id: "thread-1",
        input: { status: "DONE" },
      });
    });
  });

  it("renders a Goal panel and confirms a review-ready Goal", async () => {
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Acme onboarding",
        status: "OPEN",
        metadata: {
          customerOnboarding: { workflow: "customer_onboarding" },
        },
        messages: { edges: [] },
      },
    };
    linkedTasksData = {
      threadLinkedTasks: [
        {
          id: "linked-1",
          provider: "THINKWORK",
          title: "Get contract signed",
          required: true,
          status: "COMPLETED",
          syncStatus: "SYNCED",
        },
      ],
    };
    goalFilesData = {
      threadGoalFiles: {
        goal: {
          id: "goal-1",
          outcome: "Complete customer onboarding for Acme.",
          ownerType: null,
          ownerId: null,
          mode: "COLLABORATE",
          status: "IN_REVIEW",
          reviewPolicy: {
            required: true,
            type: "human_final_review",
          },
          updatedAt: "2026-05-27T15:00:00.000Z",
        },
        files: [
          {
            file: "GOAL",
            content: [
              "# GOAL",
              "Outcome: Complete customer onboarding for Acme.",
              "Owner: Customer onboarding team",
            ].join("\n"),
          },
          {
            file: "DECISIONS",
            content:
              "# DECISIONS\n\n## Intake Decisions\n- Credit terms requested: yes (Net 30).",
          },
          {
            file: "HANDOFFS",
            content:
              "# HANDOFFS\n\n## Current Handoffs\n- Human reviewer: confirm final onboarding review.",
          },
          {
            file: "ARTIFACTS",
            content:
              "# ARTIFACTS\n\n## Referenced Artifacts\n- Contract link: https://example.com/contract",
          },
        ],
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));

    expect(screen.getByText("Goal")).toBeTruthy();
    expect(
      screen.getByText("Complete customer onboarding for Acme."),
    ).toBeTruthy();
    expect(screen.getByText("Collaborate mode")).toBeTruthy();
    expect(screen.getByText("Human final review required")).toBeTruthy();
    expect(
      screen.getByText(
        "Required work is complete. A human reviewer must confirm before closure.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as completed" })).toBe(
      null,
    );
    expect(screen.queryByText("DECISIONS.md")).toBe(null);
    expect(screen.queryByText("HANDOFFS.md")).toBe(null);

    fireEvent.click(
      screen.getByRole("button", { name: "Request Goal changes" }),
    );
    fireEvent.change(screen.getByLabelText("Change request"), {
      target: { value: "Need AP email before closure." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create follow-up" }));

    await waitFor(() => {
      expect(reviewGoalMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          goalId: "goal-1",
          action: "REQUEST_CHANGES",
          notes: "Need AP email before closure.",
        },
      });
    });
    reviewGoalMock.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm Goal completion" }),
    );

    await waitFor(() => {
      expect(reviewGoalMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          goalId: "goal-1",
          action: "CONFIRM_COMPLETION",
        },
      });
    });
    expect(reexecuteGoalFilesQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("passes follow-up agent opt-out through SendMessageInput", async () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    setFollowUpText("For the human collaborators only");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "For the human collaborators only",
          agentRequested: false,
        },
      });
    });
  });

  it("does not show the processing shimmer for agent opt-out follow-ups", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Human-only thread",
        lifecycleStatus: "COMPLETED",
        messages: { edges: [] },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    setFollowUpText("Visible to collaborators only");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByText("Visible to collaborators only")).toBeTruthy();
    });
    expect(screen.queryByLabelText("Processing request")).toBeNull();
  });

  it("shows the running turn surface for agent-bound optimistic follow-ups", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Agent thread",
        lifecycleStatus: "COMPLETED",
        messages: { edges: [] },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    setFollowUpText("Ask the agent for help");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByText("Ask the agent for help")).toBeTruthy();
    });
    // The optimistic running turn is the single in-flight signal (KTD2).
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.queryByLabelText("Processing request")).toBeNull();
  });

  it("keeps the follow-up working row after the user message persists before the agent result", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Agent thread",
        lifecycleStatus: "COMPLETED",
        messages: { edges: [] },
      },
    };

    const { rerender } = render(
      <SpacesThreadDetailRoute threadId="thread-1" />,
    );

    setFollowUpText("What's my wife's name?");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByText("What's my wife's name?")).toBeTruthy();
    });
    expect(screen.getByText("Working…")).toBeTruthy();

    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Agent thread",
        lifecycleStatus: "RUNNING",
        messages: {
          edges: [
            {
              node: {
                id: "message-follow-up",
                role: "USER",
                content: "What's my wife's name?",
                createdAt: "2026-06-02T19:20:00.000Z",
              },
            },
          ],
        },
      },
    };

    rerender(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(screen.getByText("What's my wife's name?")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
  });

  it("continues polling while a real turn is running and the latest user has no assistant", async () => {
    vi.useFakeTimers();
    try {
      taskData = {
        computerTasks: [
          {
            id: "task-running",
            status: "RUNNING",
            input: { source: "chat_message" },
            claimedAt: "2026-06-02T19:20:01.000Z",
            completedAt: null,
            createdAt: "2026-06-02T19:20:01.000Z",
          },
        ],
      };
      threadData = {
        thread: {
          id: "thread-1",
          computerId: "computer-1",
          title: "Agent thread",
          lifecycleStatus: "RUNNING",
          messages: {
            edges: [
              {
                node: {
                  id: "message-follow-up",
                  role: "USER",
                  content: "Still waiting",
                  createdAt: "2026-06-02T19:20:00.000Z",
                },
              },
            ],
          },
        },
      };

      render(<SpacesThreadDetailRoute threadId="thread-1" />);
      expect(screen.getByText("Working…")).toBeTruthy();

      reexecuteThreadQuery.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });

      expect(reexecuteThreadQuery).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes follow-up sends through managed AgentCore in desktop builds", async () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {},
    });
    threadData = {
      thread: {
        id: "thread-1",
        agentId: "agent-1",
        title: "Agent thread",
        lifecycleStatus: "COMPLETED",
        messages: { edges: [] },
      },
    };
    sendMessage.mockResolvedValue({
      data: { sendMessage: { id: "message-local-1" } },
    });

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    setFollowUpText("Run this through AgentCore");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "Run this through AgentCore",
        },
      });
    });
  });

  it("sends selected approved model metadata for follow-up turns", async () => {
    approvedModelsData = {
      myApprovedModelCatalog: [
        {
          id: "model-haiku",
          modelId: "anthropic.claude-haiku",
          displayName: "Claude Haiku",
          provider: "amazon_bedrock",
          inputCostPerMillion: 0.15,
          outputCostPerMillion: 0.6,
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Select model").textContent).toContain(
        "Claude Haiku",
      );
    });
    setFollowUpText("Use the approved follow-up model");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "Use the approved follow-up model",
          modelId: "anthropic.claude-haiku",
          metadata: JSON.stringify({
            requestedModelId: "anthropic.claude-haiku",
          }),
        },
      });
    });
  });

  it("keeps goal mode metadata in the same follow-up metadata envelope", () => {
    expect(spacesThreadDetailRouteSource).toContain("appendGoalModeMetadata");
    expect(spacesThreadDetailRouteSource).toContain(
      "if (attachmentRefs.length > 0) metadata.attachments = attachmentRefs;",
    );
    expect(spacesThreadDetailRouteSource).toContain(
      "metadata.requestedModelId = turnModelId;",
    );
    expect(spacesThreadDetailRouteSource).toContain(
      "metadata = appendGoalModeMetadata(metadata, goalMode);",
    );
  });

  it("seeds the composer with the thread's last-used model over the global stored pick", async () => {
    window.localStorage.setItem(
      APPROVED_MODEL_STORAGE_KEY,
      "anthropic.claude-haiku",
    );
    approvedModelsData = {
      myApprovedModelCatalog: [
        {
          id: "model-haiku",
          modelId: "anthropic.claude-haiku",
          displayName: "Claude Haiku",
          provider: "amazon_bedrock",
          inputCostPerMillion: 0.15,
          outputCostPerMillion: 0.6,
        },
        {
          id: "model-sonnet",
          modelId: "anthropic.claude-sonnet",
          displayName: "Claude Sonnet",
          provider: "amazon_bedrock",
          inputCostPerMillion: 3,
          outputCostPerMillion: 15,
        },
      ],
    };
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Route streaming thread",
        lifecycleStatus: "COMPLETED",
        lastModel: "anthropic.claude-sonnet",
        messages: { edges: [] },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Select model").textContent).toContain(
        "Claude Sonnet",
      );
    });
    expect(screen.getByLabelText("Select model").textContent).not.toContain(
      "Claude Haiku",
    );
  });

  it("falls back to the stored model when the thread has no last-used model", async () => {
    window.localStorage.setItem(
      APPROVED_MODEL_STORAGE_KEY,
      "anthropic.claude-haiku",
    );
    approvedModelsData = {
      myApprovedModelCatalog: [
        {
          id: "model-haiku",
          modelId: "anthropic.claude-haiku",
          displayName: "Claude Haiku",
          provider: "amazon_bedrock",
          inputCostPerMillion: 0.15,
          outputCostPerMillion: 0.6,
        },
        {
          id: "model-sonnet",
          modelId: "anthropic.claude-sonnet",
          displayName: "Claude Sonnet",
          provider: "amazon_bedrock",
          inputCostPerMillion: 3,
          outputCostPerMillion: 15,
        },
      ],
    };
    threadData = {
      thread: {
        id: "thread-1",
        computerId: "computer-1",
        title: "Route streaming thread",
        lifecycleStatus: "COMPLETED",
        lastModel: null,
        messages: { edges: [] },
      },
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Select model").textContent).toContain(
        "Claude Haiku",
      );
    });
  });

  it("keeps onboarding task updates on the managed send path", async () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {},
    });
    threadData = {
      thread: {
        id: "thread-1",
        agentId: "agent-1",
        title: "Customer onboarding",
        lifecycleStatus: "COMPLETED",
        messages: { edges: [] },
      },
    };
    sendMessage.mockResolvedValue({
      data: {
        sendMessage: {
          id: "message-local-1",
          metadata: {
            customerOnboardingChatUpdate: {
              handled: true,
              agentDispatchRequired: false,
            },
          },
        },
      },
    });

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    setFollowUpText("DocuSign is complete");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "DocuSign is complete",
        },
      });
    });
    expect(reexecuteLinkedTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteGoalFilesQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("renders visible managed delegation turns in the existing activity row", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        title: "Agent thread",
        lifecycleStatus: "RUNNING",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Delegate visible work",
              },
            },
          ],
        },
      },
    };
    threadTurnsData = {
      threadTurns: [
        {
          id: "turn-visible-worker",
          threadId: "thread-1",
          invocationSource: "desktop_managed_delegation",
          status: "running",
          startedAt: "2026-05-28T12:00:00.000Z",
          contextSnapshot: {
            desktop_managed_delegation: { visibility: "visible" },
          },
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Turn activity")).toBeTruthy();
    });
    const activity = screen.getAllByLabelText("Turn activity")[0];
    fireEvent.click(within(activity).getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/Managed delegation/)).toBeTruthy();
    });
  });

  it("replays persisted thread turn events after returning to a thread", async () => {
    taskData = { computerTasks: [] };
    threadData = {
      thread: {
        id: "thread-1",
        title: "Agent profile thread",
        lifecycleStatus: "COMPLETED",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content: "Analyst review this budget forecast",
                createdAt: "2026-06-10T15:55:00.000Z",
              },
            },
            {
              node: {
                id: "message-2",
                role: "ASSISTANT",
                content: "Here are the key takeaways.",
                createdAt: "2026-06-10T15:56:10.000Z",
              },
            },
          ],
        },
      },
    };
    threadTurnsData = {
      threadTurns: [
        {
          id: "turn-agent-profile",
          threadId: "thread-1",
          invocationSource: "chat_message",
          status: "succeeded",
          startedAt: "2026-06-10T15:55:05.000Z",
          finishedAt: "2026-06-10T15:56:10.000Z",
          usageJson: {
            inputTokens: 1,
            outputTokens: 2000,
          },
          totalCost: 0.0343,
        },
      ],
    };
    apiFetchMock.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/api/trigger-runs/turn-agent-profile/events?limit=500") {
        return [
          {
            id: "event-agent-profile-completed",
            run_id: "turn-agent-profile",
            event_type: "agent_profile_run_completed",
            level: "info",
            payload: {
              profile_slug: "analyst",
              profile_name: "Analyst",
              status: "completed",
              duration_ms: 68500,
              tool_invocations: [
                {
                  tool_name: "spreadsheet_analysis",
                  output_preview: "Reviewed workbook variance.",
                },
              ],
            },
            created_at: "2026-06-10T15:56:09.000Z",
          },
        ];
      }
      return [];
    });

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    await waitFor(() => {
      const activity = screen.getByLabelText("Turn activity");
      expect(within(activity).getByText("Worked for 1m 10s")).toBeTruthy();
      expect(within(activity).getByText("1 in / 2.0K out")).toBeTruthy();
      expect(within(activity).getByText("$0.0343")).toBeTruthy();
      expect(apiFetchMock.apiFetch).toHaveBeenCalledWith(
        "/api/trigger-runs/turn-agent-profile/events?limit=500",
        { extraHeaders: { "x-tenant-id": "tenant-1" } },
      );
    });

    const activity = screen.getByLabelText("Turn activity");
    fireEvent.click(within(activity).getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Agent Profile: Analyst")).toBeTruthy();
      expect(screen.getByText(/Reviewed workbook variance/)).toBeTruthy();
    });
  });

  it("does not render hidden managed delegation turns as extra chrome", async () => {
    taskData = { computerTasks: [] };
    threadTurnsData = {
      threadTurns: [
        {
          id: "turn-hidden-worker",
          threadId: "thread-1",
          invocationSource: "desktop_managed_delegation",
          status: "running",
          startedAt: "2026-05-28T12:00:00.000Z",
          contextSnapshot: {
            desktop_managed_delegation: { visibility: "hidden" },
          },
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    expect(screen.queryByText(/Managed delegation/)).toBeNull();
  });
});

function renderHeaderAction() {
  const lastCall = vi.mocked(usePageHeaderActions).mock.calls.at(-1);
  const action = lastCall?.[0]?.action;
  if (!action) throw new Error("expected page header action");
  render(<>{action}</>);
}

function renderHeaderTitleTrailing() {
  const lastCall = vi.mocked(usePageHeaderActions).mock.calls.at(-1);
  const titleTrailing = lastCall?.[0]?.titleTrailing;
  if (!titleTrailing) throw new Error("expected page header title trailing");
  render(<>{titleTrailing}</>);
}

function queryState(data: unknown) {
  return { data, fetching: false, stale: false, hasNext: false };
}
