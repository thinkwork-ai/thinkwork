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
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import {
  ComputerThreadDetailRoute,
  deriveThreadArtifacts,
  resolveThreadArtifactSelection,
} from "./ComputerThreadDetailRoute";

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
const reexecuteTasksQuery = vi.fn();
const sendMessage = vi.fn();
const resetStreamingChunks = vi.fn();

let threadData: unknown;
let taskData: unknown;
let eventData: unknown;
let mentionTargetsData: unknown;
let streamingChunks: Array<{ seq: number; text: string }> = [];

beforeEach(() => {
  vi.mocked(usePageHeaderActions).mockReset();
  reexecuteThreadQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  sendMessage.mockReset();
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

  vi.mocked(useMutation).mockReturnValue([
    { fetching: false, stale: false, hasNext: false },
    sendMessage,
  ]);
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
      | { messageLimit?: number; threadId?: string; limit?: number }
      | undefined;
    if (variables?.messageLimit) {
      return [queryState(threadData), reexecuteThreadQuery];
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

describe("ComputerThreadDetailRoute", () => {
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
    render(<ComputerThreadDetailRoute threadId="thread-1" />);

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ backHref: expect.any(String) }),
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

    render(<ComputerThreadDetailRoute threadId="thread-1" />);

    expect(reexecuteThreadQuery).not.toHaveBeenCalled();
    expect(reexecuteTasksQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
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

    render(<ComputerThreadDetailRoute threadId="thread-1" />);

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

    render(<ComputerThreadDetailRoute threadId="thread-1" />);

    expect(screen.getByText("Durable assistant answer")).toBeTruthy();
    expect(screen.queryByText("Transient streamed text")).toBeNull();
    await waitFor(() => {
      expect(resetStreamingChunks).toHaveBeenCalled();
    });
  });
});

function queryState(data: unknown) {
  return { data, fetching: false, stale: false, hasNext: false };
}
