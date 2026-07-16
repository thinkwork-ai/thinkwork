/**
 * Self-acquired review workflow tests (governed autonomy). Covers the
 * click-to-review connection detail (signed descriptor operations with
 * reversibility/data classes/target, adapter + binding requirements,
 * provenance + signature envelope, binding readiness with redacted probe
 * evidence, raw descriptor JSON), the revoke-from-binding affordance, the
 * click-to-review routine detail delegating to RoutineProposalReview with
 * the operator/read-only split, and that the summary feed + one-click
 * principal revoke keep working.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, refetchMocks, revokeMock, toastMock, queryDocs } =
  vi.hoisted(() => ({
    queryState: {
      catalog: {
        data: { capabilityRuntimeCatalog: [] } as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
      routines: {
        data: { routineProposals: [] } as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
      principals: {
        data: { tenantServicePrincipals: [] } as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
      bindings: {
        data: { capabilityCredentialBindings: [] } as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    refetchMocks: {
      catalog: vi.fn(),
      routines: vi.fn(),
      principals: vi.fn(),
      bindings: vi.fn(),
    },
    revokeMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    queryDocs: {
      CapabilityRuntimeCatalogQuery: Symbol("runtimeCatalog"),
      RoutineProposalsQuery: Symbol("routineProposals"),
      TenantServicePrincipalsQuery: Symbol("servicePrincipals"),
      CapabilityCredentialBindingsQuery: Symbol("credentialBindings"),
      RevokeServicePrincipalMutation: Symbol("revokePrincipal"),
    },
  }));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.CapabilityRuntimeCatalogQuery) {
      return [queryState.catalog, refetchMocks.catalog];
    }
    if (query === queryDocs.RoutineProposalsQuery) {
      return [queryState.routines, refetchMocks.routines];
    }
    if (query === queryDocs.TenantServicePrincipalsQuery) {
      return [queryState.principals, refetchMocks.principals];
    }
    if (query === queryDocs.CapabilityCredentialBindingsQuery) {
      return [queryState.bindings, refetchMocks.bindings];
    }
    throw new Error("unexpected query");
  },
  useMutation: () => [{ fetching: false }, revokeMock],
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);
// The routine review surface has its own suite — assert delegation only.
vi.mock("@/components/approvals/RoutineProposalReview", () => ({
  RoutineProposalReview: (props: {
    proposalId: string;
    tenantId: string;
    readOnly?: boolean;
  }) => (
    <div
      data-testid="routine-review-stub"
      data-proposal-id={props.proposalId}
      data-read-only={String(props.readOnly ?? false)}
    />
  ),
}));
// AlertDialog renders as a controlled passthrough so the confirm button is
// directly clickable without Radix portal plumbing.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    AlertDialog: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) => (open ? <div>{children}</div> : null),
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogFooter: pass,
    AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick} data-testid="confirm-revoke">
        {children}
      </button>
    ),
  };
});

import { SelfAcquiredView } from "./SelfAcquiredView";

const DESCRIPTOR = {
  namespace: "web",
  class: "connection",
  slug: "hacker-news-firebase",
  version: "1",
  adapter: {
    kind: "http_openapi",
    config: { baseUrl: "https://hacker-news.firebaseio.com" },
  },
  bindingRequirements: { credentialKinds: [], principalModes: ["service"] },
  provenance: {
    sourceUrls: ["https://github.com/HackerNews/API"],
    evidenceRefs: [],
  },
  operations: [
    {
      operationId: "top-stories",
      summary: "List top story ids",
      effect: "read",
      targetScope: {
        kind: "closed",
        resourceSelector: {
          method: "GET",
          host: "hacker-news.firebaseio.com",
          path: "/v0/topstories.json",
        },
      },
      reversibility: "reversible",
      idempotency: "idempotent",
      principalModes: ["service"],
      approvalPolicy: "never",
      inputSchema: {},
      outputSchema: {},
      inputDataClass: "public",
      outputDataClass: "public",
      costClass: "low",
      latencyClass: "fast",
      outputClass: "json",
    },
  ],
};

function selfAdmittedDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: "def-1",
    tenantId: "tenant-1",
    namespace: "web",
    class: "connection",
    slug: "hacker-news-firebase",
    displayName: "Hacker News",
    status: "active",
    createdAt: "2026-07-15T00:00:00Z",
    versions: [],
    admittedVersion: {
      id: "ver-1",
      version: 1,
      lifecycle: "admitted",
      descriptorFingerprint: "fp-descriptor-1234",
      descriptor: JSON.stringify(DESCRIPTOR),
      provenance: JSON.stringify({
        sourceUrls: ["https://github.com/HackerNews/API"],
      }),
      signature: JSON.stringify({
        version: 1,
        algorithm: "hmac-sha256",
        payloadHash: "abcd",
        signature: "sig",
        signed_by: "agent-self-extension",
        signed_at: "2026-07-15T01:00:00Z",
      }),
      admittedAt: "2026-07-15T01:00:00Z",
      admittedByUserId: null,
      admissionMode: "autonomous",
      admittedByAgentId: "agent-abcdef123456",
      operations: [
        {
          operationId: "top-stories",
          twcap: "twcap://web/connection/hacker-news-firebase/1#top-stories",
          contractHash: "hash-1",
          effect: "read",
          principalModes: ["service"],
          approvalPolicy: "never",
          costClass: "low",
          latencyClass: "fast",
          outputClass: "json",
          executable: true,
          withheldReasons: [],
        },
      ],
    },
    ...overrides,
  };
}

function setCatalog(definitions: unknown[]) {
  queryState.catalog = {
    data: { capabilityRuntimeCatalog: definitions },
    fetching: false,
    error: undefined,
  };
}

function setRoutines(proposals: unknown[]) {
  queryState.routines = {
    data: { routineProposals: proposals },
    fetching: false,
    error: undefined,
  };
}

function setPrincipals(principals: unknown[]) {
  queryState.principals = {
    data: { tenantServicePrincipals: principals },
    fetching: false,
    error: undefined,
  };
}

function setBindings(bindings: unknown[]) {
  queryState.bindings = {
    data: { capabilityCredentialBindings: bindings },
    fetching: false,
    error: undefined,
  };
}

function routineProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    tenantId: "tenant-1",
    routineId: "routine-1",
    payloadFingerprint: "fp-1",
    status: "approved",
    approvalMode: "autonomous",
    inboxItemId: null,
    createdByActorType: "agent",
    createdByActorId: "agent-abcdef123456",
    decidedAt: "2026-07-15T02:00:00Z",
    promotedCommitSha: null,
    createdAt: "2026-07-15T01:30:00Z",
    ...overrides,
  };
}

function renderView(canManage = true) {
  return render(<SelfAcquiredView tenantId="tenant-1" canManage={canManage} />);
}

beforeEach(() => {
  setCatalog([]);
  setRoutines([]);
  setPrincipals([]);
  setBindings([]);
  for (const mock of Object.values(refetchMocks)) mock.mockReset();
  revokeMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("SelfAcquiredView connection review", () => {
  it("expands a self-admitted connection into the full descriptor review", () => {
    setCatalog([selfAdmittedDefinition()]);
    setBindings([
      {
        id: "bind-1",
        definitionVersionId: "ver-1",
        principalMode: "service",
        servicePrincipalId: "sp-1",
        readiness: "ready",
        readinessEvidence: JSON.stringify({ statusCode: 200, durationMs: 41 }),
        lastVerifiedAt: "2026-07-15T01:05:00Z",
        revokedAt: null,
      },
    ]);
    renderView();

    // Collapsed by default.
    expect(
      screen.queryByTestId("self-acquired-connection-detail-def-1"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("self-acquired-connection-toggle-def-1"),
    );

    const detail = screen.getByTestId("self-acquired-connection-detail-def-1");
    // Provenance + signature envelope.
    expect(detail.textContent).toContain("mode autonomous");
    expect(
      screen.getByTestId("self-acquired-signature-def-1").textContent,
    ).toContain("agent-self-extension");
    expect(detail.textContent).toContain("https://github.com/HackerNews/API");
    // Adapter + binding requirements.
    expect(detail.textContent).toContain("http_openapi");
    expect(detail.textContent).toContain("https://hacker-news.firebaseio.com");
    expect(detail.textContent).toContain("none (credential-free)");
    // Operations table merges the view with descriptor annotations.
    const ops = screen.getByTestId("self-acquired-ops-def-1");
    expect(ops.textContent).toContain("top-stories");
    expect(ops.textContent).toContain("GET /v0/topstories.json");
    expect(ops.textContent).toContain("reversible");
    expect(ops.textContent).toContain("public / public");
    expect(ops.textContent).toContain("low / fast / json");
    // Binding readiness + redacted probe evidence.
    const binding = screen.getByTestId("self-acquired-binding-bind-1");
    expect(binding.textContent).toContain("ready");
    expect(binding.textContent).toContain("status 200");
    expect(binding.textContent).toContain("41ms");
    // Raw descriptor JSON is available for first-principles review.
    expect(
      screen.getByTestId("self-acquired-descriptor-raw-def-1").textContent,
    ).toContain('"baseUrl": "https://hacker-news.firebaseio.com"');
  });

  it("revokes the acquiring service principal from the binding row", async () => {
    revokeMock.mockResolvedValue({
      data: { revokeServicePrincipal: { outcome: "applied" } },
    });
    setCatalog([selfAdmittedDefinition()]);
    setPrincipals([
      {
        id: "sp-1",
        slug: "self-ext",
        displayName: "Agent self-extension",
        purpose: "autonomous self-extension",
        status: "active",
        createdAt: "2026-07-15T00:00:00Z",
        revokedAt: null,
      },
    ]);
    setBindings([
      {
        id: "bind-1",
        definitionVersionId: "ver-1",
        principalMode: "service",
        servicePrincipalId: "sp-1",
        readiness: "ready",
        readinessEvidence: null,
        lastVerifiedAt: null,
        revokedAt: null,
      },
    ]);
    renderView();
    fireEvent.click(
      screen.getByTestId("self-acquired-connection-toggle-def-1"),
    );
    fireEvent.click(screen.getByTestId("self-acquired-binding-revoke-bind-1"));
    fireEvent.click(screen.getByTestId("confirm-revoke"));
    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        servicePrincipalId: "sp-1",
      }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("offers no revoke affordance to non-operators", () => {
    setCatalog([selfAdmittedDefinition()]);
    setBindings([
      {
        id: "bind-1",
        definitionVersionId: "ver-1",
        principalMode: "service",
        servicePrincipalId: "sp-1",
        readiness: "ready",
        readinessEvidence: null,
        lastVerifiedAt: null,
        revokedAt: null,
      },
    ]);
    renderView(false);
    fireEvent.click(
      screen.getByTestId("self-acquired-connection-toggle-def-1"),
    );
    expect(
      screen.queryByTestId("self-acquired-binding-revoke-bind-1"),
    ).toBeNull();
  });
});

describe("SelfAcquiredView routine review", () => {
  it("expands a self-promoted routine into the promotion review surface", () => {
    setRoutines([routineProposal()]);
    renderView();
    expect(screen.queryByTestId("routine-review-stub")).toBeNull();
    fireEvent.click(screen.getByTestId("self-acquired-routine-toggle-prop-1"));
    const stub = screen.getByTestId("routine-review-stub");
    expect(stub.getAttribute("data-proposal-id")).toBe("prop-1");
    expect(stub.getAttribute("data-read-only")).toBe("false");
  });

  it("mounts the routine review read-only for non-operators", () => {
    setRoutines([routineProposal()]);
    renderView(false);
    fireEvent.click(screen.getByTestId("self-acquired-routine-toggle-prop-1"));
    expect(
      screen.getByTestId("routine-review-stub").getAttribute("data-read-only"),
    ).toBe("true");
  });

  it("only lists autonomous proposals", () => {
    setRoutines([
      routineProposal(),
      routineProposal({ id: "prop-2", approvalMode: "operator" }),
    ]);
    renderView();
    expect(screen.getByTestId("self-acquired-routine-prop-1")).toBeTruthy();
    expect(screen.queryByTestId("self-acquired-routine-prop-2")).toBeNull();
  });
});

describe("SelfAcquiredView feed basics", () => {
  it("keeps the one-click principal revoke on the access list", async () => {
    revokeMock.mockResolvedValue({
      data: { revokeServicePrincipal: { outcome: "applied" } },
    });
    setPrincipals([
      {
        id: "sp-1",
        slug: "self-ext",
        displayName: "Agent self-extension",
        purpose: "autonomous self-extension",
        status: "active",
        createdAt: "2026-07-15T00:00:00Z",
        revokedAt: null,
      },
    ]);
    renderView();
    fireEvent.click(screen.getByTestId("self-acquired-revoke-sp-1"));
    fireEvent.click(screen.getByTestId("confirm-revoke"));
    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        servicePrincipalId: "sp-1",
      }),
    );
  });

  it("renders the empty state when nothing was self-acquired", () => {
    renderView();
    expect(screen.getByTestId("self-acquired-empty")).toBeTruthy();
  });
});
