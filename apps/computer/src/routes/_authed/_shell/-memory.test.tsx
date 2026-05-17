import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const pageHeaderActionsMock = vi.fn();
const useRouterStateMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: (...args: unknown[]) => useRouterStateMock(...args),
    createFileRoute: () => (config: Record<string, unknown>) => ({
      ...config,
      useSearch: () => ({}),
      useNavigate: () => navigateMock,
    }),
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children: React.ReactNode;
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    Outlet: () => <div data-testid="outlet" />,
  };
});

vi.mock("urql", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-A" }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { sub: "cognito-sub-1", email: "eric@example.com", groups: [] },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    signOut: vi.fn(),
    getToken: vi.fn(),
  }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (actions: unknown) => pageHeaderActionsMock(actions),
}));

vi.mock("@thinkwork/graph", () => ({
  MemoryGraph: () => <div data-testid="memory-graph-stub" />,
  STRATEGY_COLORS: {},
  PAGE_TYPE_BADGE_CLASSES: {},
  WikiGraph: () => <div data-testid="wiki-graph-stub" />,
  pageTypeLabel: (t: string) => t,
}));

import { Route as BrainRoute } from "./memory.brain";

beforeEach(() => {
  navigateMock.mockReset();
  useQueryMock.mockReset();
  pageHeaderActionsMock.mockReset();
  useRouterStateMock.mockReset();

  useQueryMock.mockReturnValue([{ data: undefined, fetching: false }, vi.fn()]);
  useRouterStateMock.mockReturnValue("/memory/brain");
});

afterEach(cleanup);

const BrainPage = (
  BrainRoute as unknown as { component: () => React.ReactElement }
).component;

describe("apps/computer Memory in-page tab strip", () => {
  it("renders the 'Memories' tab in-page on the Brain route, with no 'Brain' tab", () => {
    render(<BrainPage />);
    expect(screen.getByRole("tab", { name: "Memories" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Brain" })).toBeNull();
  });

  it("renders Memories | Pages | KBs in that order", () => {
    render(<BrainPage />);
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((el) => el.textContent ?? "");
    expect(labels).toEqual(["Memories", "Pages", "KBs"]);
  });

  it("highlights the KBs tab when the pathname is a /memory/kbs/$kbId child", () => {
    useRouterStateMock.mockReturnValue("/memory/kbs/some-kb-id");
    render(<BrainPage />);
    const kbsTab = screen.getByRole("tab", { name: "KBs" });
    expect(kbsTab.getAttribute("data-state")).toBe("active");
  });

  it("highlights the Memories tab on /memory/brain", () => {
    useRouterStateMock.mockReturnValue("/memory/brain");
    render(<BrainPage />);
    const memoriesTab = screen.getByRole("tab", { name: "Memories" });
    expect(memoriesTab.getAttribute("data-state")).toBe("active");
  });

  it("uses 40px table rows for memory records", async () => {
    useQueryMock.mockReset();
    useQueryMock
      .mockReturnValueOnce([
        {
          data: {
            memoryRecords: [
              {
                memoryRecordId: "memory-1",
                content: { text: "A compact table fact." },
                createdAt: "2026-05-11T12:00:00.000Z",
                namespace: "user_requester-1",
                strategy: "semantic",
              },
            ],
          },
          fetching: false,
        },
        vi.fn(),
      ])
      .mockReturnValueOnce([{ data: undefined, fetching: false }]);

    render(<BrainPage />);

    const memory = await screen.findByText("A compact table fact.");
    const row = memory.closest("tr");
    expect(row?.className).toContain("h-10");
    expect(row?.className).toContain("[&>td]:py-0");
    expect(row?.className).toContain("[&>td]:overflow-hidden");
  });
});
