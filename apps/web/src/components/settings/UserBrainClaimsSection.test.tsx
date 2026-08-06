/**
 * Brain access section tests (THINK-625).
 *
 * Three behaviors carry real consequences and are pinned here: the section
 * never renders for a non-operator (it is authorization data), a wildcard
 * grant is called out rather than shown as one slug among many, and a failed
 * manifest publish is surfaced as "not in effect yet" with a working Retry
 * instead of a bare "Saved".
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryResponses, executeMutationMock, tenantState } = vi.hoisted(() => ({
  queryResponses: new Map<string, { data?: unknown; error?: unknown }>(),
  executeMutationMock: vi.fn(),
  tenantState: {
    tenantId: "tenant-1" as string | null,
    isOperator: true,
    roleResolved: true,
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query, pause }: { query: unknown; pause?: boolean }) => {
    const response = pause ? {} : (queryResponses.get(docKeyOf(query)) ?? {});
    return [
      { data: response.data, error: response.error, fetching: false },
      vi.fn(),
    ];
  },
  useMutation: (mutation: unknown) => [
    { fetching: false },
    (variables: unknown) =>
      Promise.resolve(executeMutationMock(docKeyOf(mutation), variables) ?? {}),
  ],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState,
}));

function docKeyOf(doc: unknown): string {
  const text = JSON.stringify(doc) ?? "";
  // Most specific first — every name below contains "UserBrainClaims".
  for (const name of [
    "SettingsRepublishUserClaimsManifest",
    "SettingsSetUserBrainClaims",
    "SettingsClearUserBrainClaims",
    "SettingsUserBrainClaims",
  ]) {
    if (text.includes(name)) return name;
  }
  return "unknown";
}

import { UserBrainClaimsSection } from "@/components/settings/UserBrainClaimsSection";

const USER_ID = "33333333-3333-4333-8333-333333333333";

function claims(overrides: Record<string, unknown> = {}) {
  return {
    id: "claims-1",
    tenantId: "tenant-1",
    userId: USER_ID,
    securityGroups: ["FINANCE"],
    kbCollections: ["handbook"],
    kbBundles: "{}",
    defaultKbBundle: null,
    toolAllowlist: null,
    isOperator: false,
    kbTrace: false,
    enabled: true,
    notes: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function seedClaims(value: unknown) {
  queryResponses.set("SettingsUserBrainClaims", {
    data: { userBrainClaims: value },
  });
}

beforeEach(() => {
  queryResponses.clear();
  executeMutationMock.mockReset();
  tenantState.tenantId = "tenant-1";
  tenantState.isOperator = true;
  tenantState.roleResolved = true;
  seedClaims(claims());
});

afterEach(cleanup);

describe("operator gating", () => {
  it("renders nothing for a non-operator member", () => {
    tenantState.isOperator = false;
    const { container } = render(<UserBrainClaimsSection userId={USER_ID} />);
    expect(container.innerHTML).toBe("");
    expect(
      screen.queryByTestId("settings-user-brain-claims-section"),
    ).toBeNull();
  });

  it("renders nothing until the caller's role has resolved", () => {
    tenantState.roleResolved = false;
    render(<UserBrainClaimsSection userId={USER_ID} />);
    expect(
      screen.queryByTestId("settings-user-brain-claims-section"),
    ).toBeNull();
  });

  it("renders the section for an operator", () => {
    render(<UserBrainClaimsSection userId={USER_ID} />);
    expect(
      screen.getByTestId("settings-user-brain-claims-section"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Security groups") as HTMLInputElement).value,
    ).toBe("FINANCE");
  });
});

describe("wildcard grants", () => {
  it("shows no warning for scoped grants", () => {
    render(<UserBrainClaimsSection userId={USER_ID} />);
    expect(screen.queryByTestId("brain-claims-wildcard-warning")).toBeNull();
  });

  it("warns when a grant list is the wildcard", async () => {
    seedClaims(claims({ securityGroups: ["*"] }));
    render(<UserBrainClaimsSection userId={USER_ID} />);
    const warning = await screen.findByTestId("brain-claims-wildcard-warning");
    expect(warning.textContent).toContain("groups");
  });

  it("names both dimensions when both are wildcarded", async () => {
    seedClaims(claims({ securityGroups: ["*"], kbCollections: ["*"] }));
    render(<UserBrainClaimsSection userId={USER_ID} />);
    const warning = await screen.findByTestId("brain-claims-wildcard-warning");
    expect(warning.textContent).toContain("groups and collections");
  });
});

describe("manifest sync state", () => {
  it("reports a successful publish as live within ~60s", async () => {
    executeMutationMock.mockReturnValue({
      data: {
        setUserBrainClaims: {
          claims: claims(),
          manifest: {
            published: true,
            key: "user-claims/x/latest.json",
            reason: null,
          },
        },
      },
    });

    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const state = await screen.findByTestId("brain-claims-sync-state");
    expect(state.textContent).toContain("within ~60s");
    expect(screen.queryByTestId("brain-claims-sync-failed")).toBeNull();
  });

  it("explains a flag-off tenant rather than claiming the change is live", async () => {
    executeMutationMock.mockReturnValue({
      data: {
        setUserBrainClaims: {
          claims: claims(),
          manifest: { published: false, key: null, reason: "claims_disabled" },
        },
      },
    });

    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const state = await screen.findByTestId("brain-claims-sync-state");
    expect(state.textContent).toContain("turned off for this tenant");
    expect(screen.queryByTestId("brain-claims-sync-failed")).toBeNull();
  });

  it("shows a destructive banner on publish failure and retries via republish", async () => {
    executeMutationMock.mockImplementation((key: string) => {
      if (key === "SettingsSetUserBrainClaims") {
        return {
          data: {
            setUserBrainClaims: {
              claims: claims(),
              manifest: { published: false, key: null, reason: "s3 exploded" },
            },
          },
        };
      }
      return {
        data: {
          republishUserClaimsManifest: {
            published: true,
            key: "user-claims/x/latest.json",
            reason: null,
          },
        },
      };
    });

    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const banner = await screen.findByTestId("brain-claims-sync-failed");
    expect(banner.textContent).toContain("s3 exploded");
    expect(banner.textContent).toContain("not in effect yet");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByTestId("brain-claims-sync-failed")).toBeNull();
    });
    expect(
      executeMutationMock.mock.calls.some(
        ([key]) => key === "SettingsRepublishUserClaimsManifest",
      ),
    ).toBe(true);
    const state = screen.getByTestId("brain-claims-sync-state");
    expect(state.textContent).toContain("within ~60s");
  });
});

describe("tool allowlist", () => {
  it("sends null when restriction is off — the Brain's surface default", async () => {
    executeMutationMock.mockReturnValue({
      data: {
        setUserBrainClaims: {
          claims: claims(),
          manifest: { published: true, key: "k", reason: null },
        },
      },
    });

    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(executeMutationMock).toHaveBeenCalled());
    const [, variables] = executeMutationMock.mock.calls[0]!;
    expect((variables as any).input.toolAllowlist).toBeNull();
  });

  it("sends an explicit list once restriction is switched on", async () => {
    seedClaims(claims({ toolAllowlist: ["brain_ask"] }));
    executeMutationMock.mockReturnValue({
      data: {
        setUserBrainClaims: {
          claims: claims(),
          manifest: { published: true, key: "k", reason: null },
        },
      },
    });

    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(executeMutationMock).toHaveBeenCalled());
    const [, variables] = executeMutationMock.mock.calls[0]!;
    expect((variables as any).input.toolAllowlist).toEqual(["brain_ask"]);
  });

  it("rejects malformed KB bundle JSON before calling the server", async () => {
    render(<UserBrainClaimsSection userId={USER_ID} />);
    fireEvent.change(screen.getByLabelText("KB bundles"), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("KB bundles must be a JSON object.");
    expect(executeMutationMock).not.toHaveBeenCalled();
  });
});
