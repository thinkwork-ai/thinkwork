import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  CreateThreadMutation,
  NewThreadMentionTargetsQuery,
  SendMessageMutation,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";
import { SpacesWorkbench } from "./SpacesWorkbench";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useQuery: vi.fn(),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));

vi.mock("@/lib/use-assigned-computer-selection", () => ({
  useAssignedComputerSelection: vi.fn(),
}));

const navigate = vi.fn();
const createThread = vi.fn();
const sendMessage = vi.fn();
const startTurn = vi.fn();

beforeEach(() => {
  vi.stubGlobal("__DESKTOP_BUILD__", true);
  navigate.mockReset();
  createThread.mockReset();
  sendMessage.mockReset();
  startTurn.mockReset();
  startTurn.mockResolvedValue({ accepted: true, requestId: "local-turn-1" });
  createThread.mockResolvedValue({
    data: { createThread: { id: "thread-1", agentId: "agent-1" } },
  });
  sendMessage.mockResolvedValue({ data: { sendMessage: { id: "message-1" } } });
  vi.mocked(useNavigate).mockReturnValue(navigate);
  vi.mocked(useAssignedComputerSelection).mockReturnValue({
    computers: [],
    fetching: false,
    loaded: true,
    noAssignedComputers: false,
    selectedComputer: { id: "computer-1", name: "ThinkWork" },
    selectedComputerId: "computer-1",
    setSelectedComputerId: vi.fn(),
  });
  vi.mocked(useMutation).mockImplementation(((query) => {
    if (query === CreateThreadMutation)
      return [{ fetching: false, stale: false, hasNext: false }, createThread];
    if (query === SendMessageMutation)
      return [{ fetching: false, stale: false, hasNext: false }, sendMessage];
    return [{ fetching: false, stale: false, hasNext: false }, vi.fn()];
  }) as typeof useMutation);
  vi.mocked(useQuery).mockImplementation(((args) => {
    const { query } = args;
    if (query === NewThreadMentionTargetsQuery) {
      return [
        {
          data: {
            tenantMentionTargets: [
              {
                id: "agent:default",
                targetType: "AGENT",
                targetId: "agent-1",
                displayName: "Pi",
                aliases: ["agent"],
                isDefaultAgent: true,
                avatarUrl: null,
                role: "Default Thread agent",
              },
            ],
          },
          error: undefined,
          fetching: false,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    if (query === SpacesQuery) {
      return [
        {
          data: {
            spaces: [
              {
                id: "space-1",
                name: "Default",
                slug: "default",
                status: "active",
                templateKey: "default",
              },
            ],
          },
          error: undefined,
          fetching: false,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    return [
      {
        data: undefined,
        error: undefined,
        fetching: false,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ];
  }) as typeof useQuery);
  Object.defineProperty(window, "thinkworkBridge", {
    configurable: true,
    value: {
      pi: {
        status: "healthy",
        startTurn,
        getStatus: vi.fn(async () => ({ status: "healthy" })),
        onStatusChanged: vi.fn(() => () => {}),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
});

describe("SpacesWorkbench", () => {
  it("starts the desktop local Pi sidecar for the first message of a new thread", async () => {
    render(<SpacesWorkbench />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "Use local tools" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(createThread).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          computerId: "computer-1",
          spaceId: "space-1",
          title: "Use local tools",
          channel: "CHAT",
        },
      });
    });
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "Use local tools",
          mentions: [],
          dispatchMode: "DESKTOP_LOCAL",
        },
      });
    });
    await waitFor(() => {
      expect(startTurn).toHaveBeenCalledWith({
        agentId: "agent-1",
        threadId: "thread-1",
        messageId: "message-1",
        userMessage: "Use local tools",
      });
    });
    expect(navigate).toHaveBeenCalledWith({
      to: "/threads/$id",
      params: { id: "thread-1" },
    });
  });
});
