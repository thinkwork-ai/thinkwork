import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerWorkbench } from "./ComputerWorkbench";

const navigateMock = vi.fn();
const createThreadMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("urql", () => ({
  useQuery: () => [{ data: { myComputer: { id: "computer-1" } } }],
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

    await screen.findByText("Start");
    expect(createThreadMock).toHaveBeenCalledWith({
      input: {
        tenantId: "tenant-A",
        computerId: "computer-1",
        title: "Build a board summary",
        channel: "CHAT",
      },
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/threads/$id",
      params: { id: "thread-1" },
    });
  });
});
