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
  AddEvalReplayToolOverrideMutation,
  EvalReplayAvailableMcpToolsQuery,
  EvalReplayToolAllowlistQuery,
  RemoveEvalReplayToolOverrideMutation,
} from "@/lib/evaluation-queries";
import {
  SettingsEvalReplayTools,
  resolveToolDisposition,
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

let isOperatorValue = true;
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: isOperatorValue }),
}));

// Capture the header action JSX so the test can render + click the add
// affordance (which lives in usePageHeaderActions, not the page body).
let capturedHeaderAction: React.ReactNode = null;
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (config: { action?: React.ReactNode }) => {
    capturedHeaderAction = config.action ?? null;
  },
}));

const addOverrideMock = vi.fn();
const removeOverrideMock = vi.fn();

const overridesData = {
  evalReplayToolAllowlist: [
    {
      id: "ov-1",
      tenantId: "tenant-1",
      serverName: "lastmile--crm",
      toolName: "create_opportunity",
      mode: "allow",
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
        {
          name: "opportunities_list",
          description: "List opps",
          access: "read",
        },
        {
          name: "create_opportunity",
          description: "Create an opp",
          access: "write",
        },
      ],
    },
  ],
};

beforeEach(() => {
  isOperatorValue = true;
  addOverrideMock.mockReset();
  addOverrideMock.mockResolvedValue({ data: {}, error: undefined });
  removeOverrideMock.mockReset();
  removeOverrideMock.mockResolvedValue({ data: {}, error: undefined });

  vi.mocked(useQuery).mockImplementation((args) => {
    const { query } = args as { query: unknown };
    const data =
      query === EvalReplayToolAllowlistQuery
        ? overridesData
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
      mutation === AddEvalReplayToolOverrideMutation
        ? addOverrideMock
        : mutation === RemoveEvalReplayToolOverrideMutation
          ? removeOverrideMock
          : vi.fn();
    return [{ fetching: false }, fn] as unknown as ReturnType<
      typeof useMutation
    >;
  });
});

afterEach(cleanup);

describe("resolveToolDisposition", () => {
  it("maps heuristic access + override to a disposition", () => {
    expect(resolveToolDisposition("read", undefined)).toBe("auto-allowed");
    expect(resolveToolDisposition("write", undefined)).toBe("blocked");
    expect(resolveToolDisposition("write", "allow")).toBe("force-allowed");
    expect(resolveToolDisposition("read", "block")).toBe("force-blocked");
  });
});

describe("SettingsEvalReplayTools (U14)", () => {
  it("shows the default-allow framing and each tool's classification", () => {
    render(<SettingsEvalReplayTools />);
    expect(
      screen.getByText("Read-only tools already run on replay"),
    ).toBeTruthy();
    // The read tool shows auto-allowed; the write tool shows force-allowed
    // because an 'allow' override exists for it.
    expect(screen.getByText("opportunities_list")).toBeTruthy();
    expect(screen.getAllByText("Auto-allowed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Force-allowed").length).toBeGreaterThan(0);
  });

  it("lists the operator override in the Overrides section", () => {
    render(<SettingsEvalReplayTools />);
    expect(screen.getByText("Overrides")).toBeTruthy();
    expect(screen.getByText("lastmile--crm/create_opportunity")).toBeTruthy();
  });

  it("adds a force-block override via the dialog", async () => {
    const { rerender } = render(<SettingsEvalReplayTools />);
    render(<>{capturedHeaderAction}</>);
    fireEvent.click(screen.getByRole("button", { name: "Add override" }));
    rerender(<SettingsEvalReplayTools />);

    const serverInput = await screen.findByLabelText("Server");
    const toolInput = screen.getByLabelText("Tool");
    fireEvent.change(serverInput, { target: { value: "lastmile--crm" } });
    fireEvent.change(toolInput, { target: { value: "opportunities_list" } });
    // Toggle to force-block.
    fireEvent.click(screen.getByRole("button", { name: "Force-block" }));

    fireEvent.click(screen.getByRole("button", { name: "Add override" }));

    await waitFor(() => {
      expect(addOverrideMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        serverName: "lastmile--crm",
        toolName: "opportunities_list",
        mode: "block",
      });
    });
  });

  it("removes an override after confirming", async () => {
    render(<SettingsEvalReplayTools />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove override lastmile--crm/create_opportunity",
      }),
    );

    const confirm = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(removeOverrideMock).toHaveBeenCalledWith({ id: "ov-1" });
    });
  });

  it("hides operator affordances for a non-operator", () => {
    isOperatorValue = false;
    render(<SettingsEvalReplayTools />);
    // No header add button captured; no per-row remove button.
    expect(capturedHeaderAction).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Remove override lastmile--crm/create_opportunity",
      }),
    ).toBeNull();
  });
});
