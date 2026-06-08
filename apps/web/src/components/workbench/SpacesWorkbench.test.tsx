import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigate } from "@tanstack/react-router";

// The composer is a contenteditable token field — set text + fire `input`.
function setComposerText(value: string) {
  const el = screen.getByLabelText("Send message");
  el.textContent = value;
  fireEvent.input(el);
}
import { useMutation, useQuery } from "urql";
import {
  CreateThreadMutation,
  MyApprovedModelCatalogQuery,
  NewThreadMentionTargetsQuery,
  SendMessageMutation,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";
import {
  clearPendingThreadStart,
  getPendingThreadStart,
} from "@/lib/pending-thread-starts";
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
let approvedModels:
  | Array<{
      id: string;
      modelId: string;
      displayName: string;
      provider: string;
      inputCostPerMillion: number;
      outputCostPerMillion: number;
    }>
  | undefined;
let tenantDefaultModel: string | null;

beforeEach(() => {
  vi.stubGlobal("__DESKTOP_BUILD__", true);
  navigate.mockReset();
  createThread.mockReset();
  sendMessage.mockReset();
  approvedModels = undefined;
  tenantDefaultModel = null;
  window.localStorage.clear();
  clearPendingThreadStart("thread-1");
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
    if (query === MyApprovedModelCatalogQuery) {
      return [
        {
          data:
            approvedModels === undefined
              ? undefined
              : { myApprovedModelCatalog: approvedModels },
          error: undefined,
          fetching: false,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    if (query === SettingsTenantAgentQuery) {
      return [
        {
          data: {
            agent: { model: tenantDefaultModel },
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
    value: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
});

describe("SpacesWorkbench", () => {
  it("does not prewarm a desktop runtime workspace when New Thread loads", async () => {
    render(<SpacesWorkbench />);

    await waitFor(() => {
      expect(screen.getByLabelText("Send message")).toBeTruthy();
    });
    expect(createThread).not.toHaveBeenCalled();
  });

  it("sends the first message of a new thread through managed AgentCore", async () => {
    render(<SpacesWorkbench />);

    setComposerText("Use local tools");
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
        },
      });
    });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/threads/$id",
        params: { id: "thread-1" },
      }),
    );
    expect(getPendingThreadStart("thread-1")).toMatchObject({
      threadId: "thread-1",
      title: "Use local tools",
      content: "Use local tools",
      expectAssistantResponse: true,
    });
  });

  it("routes to the created thread before the first managed send finishes", async () => {
    let resolveSend:
      | ((value: { data: { sendMessage: { id: string } } }) => void)
      | undefined;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    render(<SpacesWorkbench />);

    setComposerText("Fast route please");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(createThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/threads/$id",
          params: { id: "thread-1" },
        }),
      );
    });

    resolveSend?.({ data: { sendMessage: { id: "message-1" } } });
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  it("defaults a new thread to the tenant's configured default model", async () => {
    approvedModels = [
      {
        id: "model-oss",
        modelId: "gpt-oss-120b",
        displayName: "GPT OSS 120B",
        provider: "openai",
        inputCostPerMillion: 0.1,
        outputCostPerMillion: 0.3,
      },
      {
        id: "model-kimi",
        modelId: "kimi-k2-5",
        displayName: "Kimi K2.5",
        provider: "moonshot",
        inputCostPerMillion: 0.2,
        outputCostPerMillion: 0.5,
      },
    ];
    // Tenant default points at the second model, not the first in the list.
    tenantDefaultModel = "kimi-k2-5";

    render(<SpacesWorkbench />);

    await waitFor(() => {
      expect(screen.getByLabelText("Select model").textContent).toContain(
        "Kimi K2.5",
      );
    });
  });

  it("sends selected approved model metadata for a new thread turn", async () => {
    approvedModels = [
      {
        id: "model-haiku",
        modelId: "anthropic.claude-haiku",
        displayName: "Claude Haiku",
        provider: "amazon_bedrock",
        inputCostPerMillion: 0.15,
        outputCostPerMillion: 0.6,
      },
    ];

    render(<SpacesWorkbench />);

    await waitFor(() => {
      expect(screen.getByLabelText("Select model").textContent).toContain(
        "Claude Haiku",
      );
    });
    setComposerText("Use the approved model");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        input: {
          threadId: "thread-1",
          role: "USER",
          content: "Use the approved model",
          mentions: [],
          modelId: "anthropic.claude-haiku",
          metadata: JSON.stringify({
            requestedModelId: "anthropic.claude-haiku",
          }),
        },
      });
    });
  });
});
