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
import { UpdateThreadMutation } from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import {
  SpacesThreadDetailRoute,
  deriveThreadArtifacts,
  resolveThreadArtifactSelection,
} from "./SpacesThreadDetailRoute";

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
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/lib/use-computer-thread-chunks", () => ({
  useComputerThreadChunks: vi.fn(),
}));

const reexecuteThreadQuery = vi.fn();
const reexecuteLinkedTasksQuery = vi.fn();
const reexecuteTasksQuery = vi.fn();
const sendMessage = vi.fn();
const updateThreadMock = vi.fn();
const resetStreamingChunks = vi.fn();

let threadData: unknown;
let taskData: unknown;
let eventData: unknown;
let mentionTargetsData: unknown;
let linkedTasksData: unknown;
let streamingChunks: Array<{ seq: number; text: string }> = [];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(usePageHeaderActions).mockReset();
  reexecuteThreadQuery.mockReset();
  reexecuteLinkedTasksQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  sendMessage.mockReset();
  updateThreadMock.mockReset();
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

  sendMessage.mockResolvedValue({});
  updateThreadMock.mockResolvedValue({});
  vi.mocked(useMutation).mockImplementation((mutation) => {
    if (mutation === UpdateThreadMutation) {
      return [
        { fetching: false, stale: false, hasNext: false },
        updateThreadMock,
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
    if (variables?.tenantId && variables?.threadId) {
      return [queryState(linkedTasksData), reexecuteLinkedTasksQuery];
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
        actionKey: expect.stringContaining(
          ":1:artifact_123:info-closed:closed",
        ),
      }),
    );
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

  it("does not render a previous thread while the route thread is loading", () => {
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

    expect(screen.getByText("Loading thread")).toBeTruthy();
    expect(screen.queryByText("Previous thread title")).toBeNull();
    expect(screen.queryByText("Old thread body")).toBeNull();
    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Thread",
        documentTitle: "Thread · Thread",
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
          title: "Get contract signed",
          required: true,
          status: "TODO",
          syncStatus: "SYNCED",
        },
      ],
    };

    render(<SpacesThreadDetailRoute threadId="thread-1" />);
    renderHeaderAction();
    fireEvent.click(screen.getByRole("button", { name: "Open thread info" }));

    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("Get contract signed")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Update Get contract signed" }),
    );

    expect(screen.getByLabelText("Follow up")).toHaveProperty(
      "value",
      "Get contract signed: ",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Complete Thread" }));

    await waitFor(() => {
      expect(updateThreadMock).toHaveBeenCalledWith({
        id: "thread-1",
        input: { status: "DONE" },
      });
    });
  });
});

function renderHeaderAction() {
  const lastCall = vi.mocked(usePageHeaderActions).mock.calls.at(-1);
  const action = lastCall?.[0]?.action;
  if (!action) throw new Error("expected page header action");
  render(<>{action}</>);
}

function queryState(data: unknown) {
  return { data, fetching: false, stale: false, hasNext: false };
}
