import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery, useSubscription } from "urql";
import { AguiThreadCanvasRoute } from "./AguiThreadCanvasRoute";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const reexecuteThreadQuery = vi.fn();
const reexecuteTasksQuery = vi.fn();
const reexecuteEventsQuery = vi.fn();
const sendMessage = vi.fn();

let threadData: unknown;
let taskData: unknown;
let eventData: unknown;
let chunkSubscriptionData: unknown;
let subscriptionCallIndex = 0;

beforeEach(() => {
  reexecuteThreadQuery.mockReset();
  reexecuteTasksQuery.mockReset();
  reexecuteEventsQuery.mockReset();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ data: { sendMessage: { id: "message-2" } } });
  subscriptionCallIndex = 0;
  chunkSubscriptionData = null;
  threadData = {
    thread: {
      id: "thread-1",
      computerId: "computer-1",
      title: "AG-UI route thread",
      messages: {
        edges: [
          {
            node: {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline risk dashboard.",
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
        createdAt: "2026-05-10T11:00:00.000Z",
      },
    ],
  };
  eventData = { computerEvents: [] };

  vi.mocked(useMutation).mockReturnValue([
    { fetching: false, stale: false, hasNext: false },
    sendMessage,
  ]);
  vi.mocked(useSubscription).mockImplementation(() => {
    subscriptionCallIndex += 1;
    if (subscriptionCallIndex === 1) {
      return [queryState(chunkSubscriptionData), () => {}];
    }
    return [queryState(null), () => {}];
  });
  vi.mocked(useQuery).mockImplementation((options) => {
    const variables = options.variables as
      | {
          messageLimit?: number;
          threadId?: string;
          computerId?: string | null;
          limit?: number;
        }
      | undefined;
    if (variables?.messageLimit) {
      return [queryState(threadData), reexecuteThreadQuery];
    }
    if (variables?.threadId && variables?.limit) {
      return [queryState(taskData), reexecuteTasksQuery];
    }
    if (variables?.computerId && variables?.limit) {
      return [queryState(eventData), reexecuteEventsQuery];
    }
    return [queryState(null), vi.fn()];
  });
});

afterEach(cleanup);

describe("AguiThreadCanvasRoute", () => {
  it("renders legacy text chunks as transcript deltas", async () => {
    chunkSubscriptionData = {
      onComputerThreadChunk: {
        threadId: "thread-1",
        seq: 1,
        chunk: { text: "Legacy chunk response" },
        publishedAt: "2026-05-10T11:01:00.000Z",
      },
    };

    render(<AguiThreadCanvasRoute threadId="thread-1" />);

    expect(
      screen.getByText("Build a CRM pipeline risk dashboard."),
    ).toBeTruthy();
    expect(await screen.findByText("Legacy chunk response")).toBeTruthy();
  });

  it("renders lifecycle and tool events from computerEvents", () => {
    eventData = {
      computerEvents: [
        {
          id: "event-1",
          taskId: "task-1",
          eventType: "thread_turn_enqueued",
          createdAt: "2026-05-10T11:00:00.000Z",
        },
        {
          id: "event-2",
          taskId: "task-1",
          eventType: "browser_automation_started",
          payload: { message: "Opening CRM" },
          createdAt: "2026-05-10T11:00:03.000Z",
        },
      ],
    };

    render(<AguiThreadCanvasRoute threadId="thread-1" />);

    expect(screen.getByText("Thread Turn Enqueued")).toBeTruthy();
    expect(screen.getByText("Browser Automation Started")).toBeTruthy();
    expect(screen.getByText("Opening CRM")).toBeTruthy();
  });

  it("shows diagnostics for malformed typed events", async () => {
    chunkSubscriptionData = {
      onComputerThreadChunk: {
        threadId: "thread-1",
        seq: 4,
        chunk: { type: "canvas_component" },
        publishedAt: "2026-05-10T11:02:00.000Z",
      },
    };

    render(<AguiThreadCanvasRoute threadId="thread-1" />);

    expect(
      await screen.findByText("canvas_component missing component or props"),
    ).toBeTruthy();
    expect(screen.getByLabelText("AG-UI diagnostics")).toBeTruthy();
  });

  it("sends a follow-up through the existing message mutation", async () => {
    render(<AguiThreadCanvasRoute threadId="thread-1" />);

    fireEvent.change(screen.getByLabelText("Follow up"), {
      target: { value: "Focus on stale enterprise deals." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "Focus on stale enterprise deals.",
        },
      });
    });
    expect(reexecuteThreadQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });
});

function queryState(data: unknown) {
  return { data, fetching: false, stale: false, hasNext: false };
}
