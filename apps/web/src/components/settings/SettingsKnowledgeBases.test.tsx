import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, kbDocs, kbRows } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  kbDocs: {
    KnowledgeBasesListQuery: Symbol("list"),
    CreateKnowledgeBaseMutation: Symbol("create"),
    UpdateKnowledgeBaseMutation: Symbol("update"),
  },
  kbRows: [
    {
      id: "kb-1",
      name: "Company Policies",
      description: "HR + finance policies",
      status: "active",
      documentCount: 4,
      lastSyncAt: null,
    },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("urql", () => ({
  useQuery: () => [
    { data: { knowledgeBases: kbRows }, fetching: false },
    vi.fn(),
  ],
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));

vi.mock("@/lib/kb-queries", () => kbDocs);

import { act } from "react";
import {
  SettingsKnowledgeBases,
  type KnowledgeBasesHeaderController,
} from "./SettingsKnowledgeBases";

// React 19 gates act() on this flag; these tests drive the published
// header controller directly.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => navigateMock.mockReset());
afterEach(cleanup);

describe("SettingsKnowledgeBases", () => {
  it("renders the tenant's Knowledge Bases without an inline create button", () => {
    render(<SettingsKnowledgeBases />);
    expect(screen.getByText("Knowledge Bases")).toBeTruthy();
    expect(screen.getByText("Company Policies")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    // The new-source gesture lives in the page header (SettingsMemoryHome
    // Plus icon), not as an inline labeled button.
    expect(screen.queryByText(/new source/i)).toBeNull();
  });

  it("opens the create dialog from the published header controller", () => {
    const controller = {
      current: null as KnowledgeBasesHeaderController | null,
    };
    render(
      <SettingsKnowledgeBases
        onHeaderControllerChange={(c) => {
          controller.current = c;
        }}
      />,
    );

    expect(controller.current).not.toBeNull();
    expect(screen.queryByText("Create source")).toBeNull();
    act(() => controller.current?.openNewSource());
    expect(screen.getByText("Create source")).toBeTruthy();
  });

  it("clears the header controller on unmount", () => {
    const controller = {
      current: null as KnowledgeBasesHeaderController | null,
    };
    const view = render(
      <SettingsKnowledgeBases
        onHeaderControllerChange={(c) => {
          controller.current = c;
        }}
      />,
    );

    expect(controller.current).not.toBeNull();
    view.unmount();
    expect(controller.current).toBeNull();
  });
});
