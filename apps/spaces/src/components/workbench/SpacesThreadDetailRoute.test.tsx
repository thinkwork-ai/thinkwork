import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery, useSubscription } from "urql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  ReviewGoalMutation,
  ThreadGoalFilesQuery,
  ThreadLinkedTasksQuery,
  ThreadProgressMarkdownQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import {
  SpacesThreadDetailRoute,
  deriveThreadArtifacts,
  resolveThreadArtifactSelection,
} from "./SpacesThreadDetailRoute";

const routerLocationStateMock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
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

const reexecuteThreadQuery = vi.fn();
const reexecuteLinkedTasksQuery = vi.fn();
const reexecuteProgressMarkdownQuery = vi.fn();
const reexecuteGoalFilesQuery = vi.fn();
const reexecuteTasksQuery = vi.fn();
const sendMessage = vi.fn();
const updateThreadMock = vi.fn();
const reviewGoalMock = vi.fn();
const resetStreamingChunks = vi.fn();

let threadData: unknown;
let taskData: unknown;
let eventData: unknown;
let mentionTargetsData: unknown;
let linkedTasksData: unknown;
let progressMarkdownData: unknown;
let goalFilesData: unknown;
let streamingChunks: Array<{ seq: number; text: string }> = [];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(usePageHeaderActions).mockReset();
  routerLocationStateMock.state = {};
  reexecuteThreadQuery.mockReset();
  reexecuteLinkedTasksQuery.mockReset();
  reexecuteProgressMarkdownQuery.mockReset();
  reexecuteGoalFilesQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  sendMessage.mockReset();
  updateThreadMock.mockReset();
  reviewGoalMock.mockReset();
  resetStreamingChunks.mockReset();
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

  sendMessage.mockResolvedValue({});
  updateThreadMock.mockResolvedValue({});
  reviewGoalMock.mockResolvedValue({});
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

afterEach(cleanup);

describe("SpacesThreadDetailRoute", () => {
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
          ":1:artifact_123:files-closed:info-closed:closed",
        ),
      }),
    );
  });

  it("anchors the thread actions menu next to the title", () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderTitleTrailing();

    expect(screen.getByRole("button", { name: "Thread actions" })).toBeTruthy();
  });

  it("refetches thread data for a manual desktop refresh event", () => {
    render(<SpacesThreadDetailRoute threadId="thread-1" />);

    window.dispatchEvent(new CustomEvent("thinkwork:desktop-refresh"));

    expect(reexecuteThreadQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
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
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));
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

      expect(screen.getByLabelText("Follow up")).toHaveProperty(
        "value",
        "Get contract signed: ",
      );
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("Follow up"));
      });
      expect(focusAttempts).toBeGreaterThan(1);
    } finally {
      focusSpy.mockRestore();
    }
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

    fireEvent.click(screen.getByRole("button", { name: "Request Goal changes" }));
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
