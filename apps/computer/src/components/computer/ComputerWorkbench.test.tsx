import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerWorkbench } from "./ComputerWorkbench";

const { navigateMock, createThreadMock, queryDocs } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  createThreadMock: vi.fn(),
  queryDocs: {
    AssignedComputersQuery: Symbol("AssignedComputersQuery"),
    CreateThreadMutation: Symbol("CreateThreadMutation"),
    NewThreadMentionTargetsQuery: Symbol("NewThreadMentionTargetsQuery"),
    SendMessageMutation: Symbol("SendMessageMutation"),
    SpacesQuery: Symbol("SpacesQuery"),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.AssignedComputersQuery) {
      return [
        {
          data: {
            assignedComputers: [{ id: "computer-1", name: "Sales Computer" }],
          },
        },
      ];
    }
    if (query === queryDocs.SpacesQuery) {
      return [
        {
          data: {
            spaces: [
              {
                id: "space-default",
                slug: "default",
                name: "Default",
                status: "active",
              },
              {
                id: "space-1",
                slug: "customer-onboarding",
                name: "Customer Onboarding",
                status: "active",
              },
            ],
          },
        },
      ];
    }
    return [
      {
        data: {
          tenantMembers: [],
          allTenantAgents: [],
        },
      },
    ];
  },
  useMutation: () => [{ fetching: false }, createThreadMock],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-A" }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  createThreadMock.mockReset();
});

afterEach(cleanup);

describe("ComputerWorkbench", () => {
  it("prefills the composer from the CRM starter card", () => {
    render(<ComputerWorkbench />);

    fireEvent.click(screen.getByRole("button", { name: /crm pipeline risk/i }));

    const textarea = screen.getByLabelText(
      "Ask your Computer",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain("CRM pipeline risk dashboard");
    expect(
      screen.getByRole("combobox", { name: /select space/i }),
    ).toHaveProperty("textContent", "Default");
  });

  it("creates a default Space thread and routes it through Chats", async () => {
    createThreadMock.mockResolvedValueOnce({
      data: { createThread: { id: "thread-1" } },
    });
    render(<ComputerWorkbench />);

    fireEvent.change(screen.getByLabelText("Ask your Computer"), {
      target: { value: "Build a board summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(createThreadMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-A",
          computerId: "computer-1",
          spaceId: "space-default",
          title: "Build a board summary",
          channel: "CHAT",
          firstMessage: "Build a board summary",
        },
      });
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/threads/$id",
      params: { id: "thread-1" },
    });
  });

  it("creates a contextual Space thread when the route selects a Space", async () => {
    createThreadMock.mockResolvedValueOnce({
      data: { createThread: { id: "thread-2" } },
    });
    render(<ComputerWorkbench spaceId="space-1" />);

    fireEvent.change(screen.getByLabelText("Ask your Computer"), {
      target: { value: "Summarize onboarding risk" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(createThreadMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-A",
          computerId: "computer-1",
          spaceId: "space-1",
          title: "Summarize onboarding risk",
          channel: "CHAT",
          firstMessage: "Summarize onboarding risk",
        },
      });
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/spaces/$spaceId/threads/$threadId",
      params: { spaceId: "space-1", threadId: "thread-2" },
    });
  });
});
