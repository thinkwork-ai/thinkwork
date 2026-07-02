/**
 * Capability inspector page tests (capability-mapping plan U4).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, refetchMock, queryDocs } = vi.hoisted(() => ({
  queryState: {
    inspector: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchMock: vi.fn(),
  queryDocs: {
    SettingsCapabilityInspectorQuery: Symbol("capabilityInspector"),
    SettingsSpacesListQuery: Symbol("spacesList"),
    SettingsAgentProfilesQuery: Symbol("agentProfiles"),
    SettingsTenantMembersQuery: Symbol("tenantMembers"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsCapabilityInspectorQuery) {
      return [queryState.inspector, refetchMock];
    }
    if (query === queryDocs.SettingsSpacesListQuery) {
      return [
        { data: { spaces: [{ id: "space-1", name: "Customer" }] } },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsAgentProfilesQuery) {
      return [
        { data: { agentProfiles: [{ id: "prof-1", name: "Coding" }] } },
        vi.fn(),
      ];
    }
    return [
      {
        data: {
          tenantMembers: [
            {
              principalType: "USER",
              principalId: "u-1",
              user: { id: "user-1", name: "Eric", email: "eric@acme.test" },
            },
          ],
        },
      },
      vi.fn(),
    ];
  },
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

import { SettingsCapabilities } from "./SettingsCapabilities";

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    capabilityInspector: {
      state: "ok",
      stateDetail: null,
      agentId: "agent-1",
      spaceId: null,
      agentProfileId: null,
      perspectiveUserId: null,
      noUserBaseline: true,
      predicted: {
        variant: "PREDICTED",
        computedAt: "2026-07-02T12:00:00.000Z",
        configFingerprint: "abcdef1234567890",
        items: [
          {
            capabilityClass: "skill",
            capabilityId: "approve-receipt",
            displayName: null,
            active: true,
            provenance: "agent: workspace folder",
            reason: null,
            detail: null,
            tokenStatus: null,
          },
          {
            capabilityClass: "skill",
            capabilityId: "stale-skill",
            displayName: null,
            active: false,
            provenance: null,
            reason: "trust_gate",
            detail: "no current passed trust report for this catalog skill",
            tokenStatus: null,
          },
          {
            capabilityClass: "mcp_server",
            capabilityId: "github",
            displayName: "GitHub",
            active: true,
            provenance: "tenant MCP registry",
            reason: null,
            detail: null,
            tokenStatus: "expired",
          },
          {
            capabilityClass: "pi_extension",
            capabilityId: "assignment-9",
            displayName: "Broken Ext",
            active: false,
            provenance: null,
            reason: "extension_validation_failed",
            detail: "verification artifact hash is stale",
            tokenStatus: null,
          },
          {
            capabilityClass: "agent_profile",
            capabilityId: "coding",
            displayName: "Coding",
            active: true,
            provenance: "tenant-global profile",
            reason: null,
            detail: null,
            tokenStatus: null,
          },
        ],
      },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryState.inspector = {
    data: inspection(),
    fetching: false,
    error: undefined,
  };
});

afterEach(() => cleanup());

describe("SettingsCapabilities", () => {
  it("renders capability classes with verbatim backend reason chips", () => {
    render(<SettingsCapabilities />);
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("MCP servers")).toBeTruthy();
    expect(screen.getByText("Pi extensions")).toBeTruthy();
    expect(screen.getByText("Agent profiles")).toBeTruthy();
    // Reason strings render verbatim (R6).
    expect(screen.getByText("trust_gate")).toBeTruthy();
    expect(screen.getByText("extension_validation_failed")).toBeTruthy();
    expect(
      screen.getByText("verification artifact hash is stale"),
    ).toBeTruthy();
    expect(screen.getByText("token: expired")).toBeTruthy();
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
  });

  it("labels the no-user baseline", () => {
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("baseline-note").textContent).toContain(
      "no-user baseline",
    );
  });

  it("shows the loading state and disables selectors while a refetch is in flight", () => {
    queryState.inspector = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("capability-loading")).toBeTruthy();
    const selectors = screen.getAllByRole("combobox");
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.hasAttribute("disabled")).toBe(true);
    }
  });

  it("renders the fault state distinctly from empty", () => {
    queryState.inspector = {
      data: inspection({
        state: "resolution_fault",
        stateDetail: "db unavailable",
        predicted: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("resolution-fault").textContent).toContain(
      "db unavailable",
    );
  });

  it("renders invalid selections with the backend detail", () => {
    queryState.inspector = {
      data: inspection({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        predicted: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("invalid-selection").textContent).toContain(
      "space not found in tenant",
    );
  });
});
