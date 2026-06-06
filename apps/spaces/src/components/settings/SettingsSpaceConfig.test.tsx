import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, updateSpaceMock, refetchMock, pageHeaderMock, spaceRecord } =
  vi.hoisted(() => ({
    queryDocs: {
      SettingsSpaceQuery: Symbol("space"),
      SettingsUpdateSpaceMutation: Symbol("updateSpace"),
    },
    updateSpaceMock: vi.fn(),
    refetchMock: vi.fn(),
    pageHeaderMock: vi.fn(),
    spaceRecord: {
      id: "space-1",
      tenantId: "tenant-1",
      name: "Customer Onboarding",
      description: "Coordinates enterprise onboarding work.",
      status: "ACTIVE",
      accessMode: "PUBLIC",
      slug: "customer-onboarding",
      config: {
        spaceManifest: {
          title: "Customer Onboarding",
          description: "Coordinates enterprise onboarding work.",
          workflows: [
            {
              key: "handoff",
              name: "Handoff",
              description: "Move work to launch.",
              source: "frontmatter",
            },
          ],
          tools: { builtIn: ["web-search"], mcp: ["slack"] },
          skills: ["finance-audit-xls"],
          runtimePolicy: { bash: "restricted" },
          reviewPolicy: { mode: "required" },
          pendingFields: ["tools", "runtime"],
        },
      },
      renderDiagnostics: {
        spaceManifest: {
          status: "warning",
          pendingFields: ["tools", "runtime"],
          diagnostics: [
            {
              severity: "warning",
              code: "SpaceManifestPendingApply",
              path: "tools",
              message:
                "tools is parsed for review, but does not automatically change runtime policy in v1.",
            },
          ],
        },
      },
      toolPolicy: null,
      mcpPolicy: null,
      builtInTools: [],
    } as Record<string, unknown>,
  }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={params?.spaceId ? to.replace("$spaceId", params.spaceId) : to}>
      {children}
    </a>
  ),
  useParams: () => ({ spaceId: "space-1" }),
}));

vi.mock("urql", () => ({
  useQuery: () => [
    { data: { space: spaceRecord }, fetching: false },
    refetchMock,
  ],
  useMutation: () => [{ fetching: false }, updateSpaceMock],
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (args: unknown) => pageHeaderMock(args),
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

import { SettingsSpaceConfig } from "./SettingsSpaceConfig";

beforeEach(() => {
  updateSpaceMock.mockReset();
  refetchMock.mockReset();
  pageHeaderMock.mockReset();
});

afterEach(cleanup);

describe("SettingsSpaceConfig", () => {
  it("renders SPACE.md workflow, tools, skills, and policy overview panels", () => {
    render(<SettingsSpaceConfig />);

    expect(screen.getAllByText("Customer Onboarding").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("SPACE.md overview")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Handoff")).toBeTruthy();
    expect(screen.getByText("web-search")).toBeTruthy();
    expect(screen.getByText("slack")).toBeTruthy();
    expect(screen.getByText("finance-audit-xls")).toBeTruthy();
    expect(screen.getByText("Review required")).toBeTruthy();
    expect(screen.getByText("Bash restricted")).toBeTruthy();
  });

  it("publishes the SPACE.md shortcut as a page-header action", () => {
    render(<SettingsSpaceConfig />);

    const lastCall = pageHeaderMock.mock.calls.at(-1)?.[0] as
      | { action?: unknown; actionKey?: string }
      | undefined;
    expect(lastCall?.action).toBeTruthy();
    expect(lastCall?.actionKey).toBe("space-files:space-1");
  });
});
