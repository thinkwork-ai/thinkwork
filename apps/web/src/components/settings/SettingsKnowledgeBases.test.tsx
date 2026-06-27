import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { SettingsKnowledgeBases } from "./SettingsKnowledgeBases";

beforeEach(() => navigateMock.mockReset());
afterEach(cleanup);

describe("SettingsKnowledgeBases", () => {
  it("renders the tenant's Brain Sources and a create action", () => {
    render(<SettingsKnowledgeBases />);
    expect(screen.getByText("Company Policies")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText(/new source/i)).toBeTruthy();
  });

  it("opens the create dialog from the new-source action", () => {
    render(<SettingsKnowledgeBases />);
    fireEvent.click(screen.getByText(/new source/i));
    expect(screen.getByText("Create source")).toBeTruthy();
  });
});
