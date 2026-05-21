import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacesWorkbench } from "./SpacesWorkbench";

const { assignedComputers, navigateMock, createThreadMock, queryDocs } =
  vi.hoisted(() => ({
    assignedComputers: [{ id: "computer-1", name: "Sales Computer" }],
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
            assignedComputers,
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
  assignedComputers.splice(0, assignedComputers.length, {
    id: "computer-1",
    name: "Sales Computer",
  });
  navigateMock.mockReset();
  createThreadMock.mockReset();
});

afterEach(cleanup);

describe("SpacesWorkbench", () => {
  it("prefills the composer from the CRM starter card", () => {
    render(<SpacesWorkbench />);

    fireEvent.click(screen.getByRole("button", { name: /crm pipeline risk/i }));

    const textarea = screen.getByLabelText(
      "Send message",
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
    render(<SpacesWorkbench />);

    fireEvent.change(screen.getByLabelText("Send message"), {
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
    render(<SpacesWorkbench spaceId="space-1" />);

    fireEvent.change(screen.getByLabelText("Send message"), {
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

  it("passes the default-space color branch to the composer", () => {
    render(<SpacesWorkbench />);

    expect(classTokens(screen.getByLabelText("Select Space"))).toContain(
      "text-muted-foreground",
    );
  });

  it("passes the non-default-space color branch to the composer", () => {
    render(<SpacesWorkbench spaceId="space-1" />);

    const trigger = screen.getByLabelText("Select Space");
    expect(classTokens(trigger)).toContain("text-foreground");
    expect(classTokens(trigger)).not.toContain("text-muted-foreground");
  });

  it("hides the 'no workspace' banner when the user has Spaces but no Computers", () => {
    // Regression: the banner used to fire on noAssignedComputers alone,
    // so an invited user with public Spaces still saw "ask your tenant
    // operator" even though they could submit. Spaces are now the
    // primary workspace concept; the banner only makes sense when both
    // computers AND spaces are empty.
    assignedComputers.splice(0, assignedComputers.length);
    render(<SpacesWorkbench />);

    expect(
      screen.queryByText(/You do not have access to a workspace yet/i),
    ).toBeNull();
  });

  it("creates a Space-first thread when no Computer is assigned", async () => {
    assignedComputers.splice(0, assignedComputers.length);
    createThreadMock.mockResolvedValueOnce({
      data: { createThread: { id: "thread-3" } },
    });
    render(<SpacesWorkbench />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "What should I work on?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(createThreadMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-A",
          spaceId: "space-default",
          title: "What should I work on?",
          channel: "CHAT",
          firstMessage: "What should I work on?",
        },
      });
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/threads/$id",
      params: { id: "thread-3" },
    });
  });
});

function classTokens(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}
