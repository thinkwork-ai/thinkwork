import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerWorkbench } from "./ComputerWorkbench";

const navigateMock = vi.fn();
const createThreadMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("urql", () => ({
  useQuery: () => [
    {
      data: {
        assignedComputers: [{ id: "computer-1", name: "Sales Computer" }],
      },
    },
  ],
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
  });

  it("creates a Computer-scoped thread and routes to it", async () => {
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
});
