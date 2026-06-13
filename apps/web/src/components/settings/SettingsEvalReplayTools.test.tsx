import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";

import {
  AddEvalReplayAllowedToolMutation,
  EvalReplayAvailableMcpToolsQuery,
  EvalReplayToolAllowlistQuery,
  RemoveEvalReplayAllowedToolMutation,
} from "@/lib/evaluation-queries";
import {
  SettingsEvalReplayTools,
  groupAllowlistByServer,
} from "./SettingsEvalReplayTools";

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
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

// Capture the header action JSX so the test can render + click the add
// affordance (which lives in usePageHeaderActions, not the page body).
let capturedHeaderAction: React.ReactNode = null;
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (config: { action?: React.ReactNode }) => {
    capturedHeaderAction = config.action ?? null;
  },
}));

const addToolMock = vi.fn();
const removeToolMock = vi.fn();

const allowlistData = {
  evalReplayToolAllowlist: [
    {
      id: "allow-1",
      tenantId: "tenant-1",
      serverName: "lastmile--crm",
      toolName: "opportunities_list",
      createdAt: "2026-06-13T00:00:00Z",
    },
  ],
};

const availableData = {
  evalReplayAvailableMcpTools: [
    {
      serverName: "lastmile--crm",
      displayName: "LastMile CRM",
      tools: [
        { name: "opportunities_list", description: "List opps" },
        { name: "contacts_list", description: "List contacts" },
      ],
    },
  ],
};

beforeEach(() => {
  addToolMock.mockReset();
  addToolMock.mockResolvedValue({ data: {}, error: undefined });
  removeToolMock.mockReset();
  removeToolMock.mockResolvedValue({ data: {}, error: undefined });

  vi.mocked(useQuery).mockImplementation((args) => {
    const { query } = args as { query: unknown };
    const data =
      query === EvalReplayToolAllowlistQuery
        ? allowlistData
        : query === EvalReplayAvailableMcpToolsQuery
          ? availableData
          : undefined;
    return [
      { data, fetching: false, stale: false },
      vi.fn(),
    ] as unknown as ReturnType<typeof useQuery>;
  });
  vi.mocked(useMutation).mockImplementation((mutation) => {
    const fn =
      mutation === AddEvalReplayAllowedToolMutation
        ? addToolMock
        : mutation === RemoveEvalReplayAllowedToolMutation
          ? removeToolMock
          : vi.fn();
    return [{ fetching: false }, fn] as unknown as ReturnType<
      typeof useMutation
    >;
  });
});

afterEach(cleanup);

describe("groupAllowlistByServer", () => {
  it("groups rows by server and sorts tools", () => {
    const grouped = groupAllowlistByServer([
      {
        id: "2",
        serverName: "b",
        toolName: "zebra",
        createdAt: "",
      },
      { id: "1", serverName: "b", toolName: "apple", createdAt: "" },
      { id: "3", serverName: "a", toolName: "cat", createdAt: "" },
    ]);
    expect(grouped.map((g) => g.serverName)).toEqual(["a", "b"]);
    expect(grouped[1].tools.map((t) => t.toolName)).toEqual(["apple", "zebra"]);
  });
});

describe("SettingsEvalReplayTools (U13)", () => {
  it("renders allowed server/tool entries", () => {
    render(<SettingsEvalReplayTools />);
    expect(screen.getByText("lastmile--crm")).toBeTruthy();
    expect(screen.getByText("opportunities_list")).toBeTruthy();
  });

  it("adds a tool via the dialog", async () => {
    const { rerender } = render(<SettingsEvalReplayTools />);
    // Open the dialog via the captured header "Allow a tool" button.
    render(<>{capturedHeaderAction}</>);
    fireEvent.click(screen.getByRole("button", { name: "Allow a tool" }));
    rerender(<SettingsEvalReplayTools />);

    const serverInput = await screen.findByLabelText("Server");
    const toolInput = screen.getByLabelText("Tool");
    fireEvent.change(serverInput, { target: { value: "lastmile--crm" } });
    fireEvent.change(toolInput, { target: { value: "contacts_list" } });

    fireEvent.click(screen.getByRole("button", { name: "Allow tool" }));

    await waitFor(() => {
      expect(addToolMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        serverName: "lastmile--crm",
        toolName: "contacts_list",
      });
    });
  });

  it("removes a tool after confirming", async () => {
    render(<SettingsEvalReplayTools />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove lastmile--crm/opportunities_list",
      }),
    );

    // Confirm in the alert dialog.
    const confirm = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(removeToolMock).toHaveBeenCalledWith({ id: "allow-1" });
    });
  });
});
