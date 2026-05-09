import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery, useSubscription } from "urql";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import { ComputerThreadDetailRoute } from "./ComputerThreadDetailRoute";

vi.mock("urql", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useSubscription: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
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
let streamingChunks: Array<{ seq: number; text: string }> = [];

beforeEach(() => {
  reexecuteThreadQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  sendMessage.mockReset();
  resetStreamingChunks.mockReset();
  streamingChunks = [];
  threadData = {
    thread: {
      id: "thread-1",
      computerId: "computer-1",
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
    if (variables?.limit) return [queryState(eventData), vi.fn()];
    return [queryState(null), vi.fn()];
  });
});

afterEach(cleanup);

describe("ComputerThreadDetailRoute", () => {
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
    expect(screen.getByText("Browser unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
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
