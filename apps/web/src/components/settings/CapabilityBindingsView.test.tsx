/**
 * Bindings view tests (THINK-280 U2): per-binding readiness grouped by
 * definition version + principal. Covers loading, error/retry, empty,
 * populated grouping, the icon+label (non-color-only) readiness indicator,
 * degraded/revoked/stale/never-verified evidence states, the single
 * remediation action per row (Verify vs Revoke), the revoke confirm flow,
 * and the service-principal panel with create/revoke.
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

const {
  queryState,
  refetchBindingsMock,
  refetchPrincipalsMock,
  verifyMock,
  revokeBindingMock,
  createPrincipalMock,
  revokePrincipalMock,
  createBindingMock,
  toastMock,
  queryDocs,
  settingsQueryDocs,
} = vi.hoisted(() => ({
  queryState: {
    bindings: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    principals: {
      data: { tenantServicePrincipals: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    catalog: {
      data: { capabilityRuntimeCatalog: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    members: {
      data: { tenantMembers: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchBindingsMock: vi.fn(),
  refetchPrincipalsMock: vi.fn(),
  verifyMock: vi.fn(),
  revokeBindingMock: vi.fn(),
  createPrincipalMock: vi.fn(),
  revokePrincipalMock: vi.fn(),
  createBindingMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  queryDocs: {
    CapabilityCredentialBindingsQuery: Symbol("credentialBindings"),
    TenantServicePrincipalsQuery: Symbol("servicePrincipals"),
    CapabilityRuntimeCatalogQuery: Symbol("runtimeCatalog"),
    VerifyCredentialBindingMutation: Symbol("verifyBinding"),
    RevokeCredentialBindingMutation: Symbol("revokeBinding"),
    CreateServicePrincipalMutation: Symbol("createPrincipal"),
    RevokeServicePrincipalMutation: Symbol("revokePrincipal"),
    CreateCredentialBindingMutation: Symbol("createBinding"),
  },
  settingsQueryDocs: {
    SettingsTenantMembersQuery: Symbol("tenantMembers"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.CapabilityCredentialBindingsQuery) {
      return [queryState.bindings, refetchBindingsMock];
    }
    if (query === queryDocs.TenantServicePrincipalsQuery) {
      return [queryState.principals, refetchPrincipalsMock];
    }
    if (query === queryDocs.CapabilityRuntimeCatalogQuery) {
      return [queryState.catalog, vi.fn()];
    }
    if (query === settingsQueryDocs.SettingsTenantMembersQuery) {
      return [queryState.members, vi.fn()];
    }
    throw new Error("unexpected query");
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.VerifyCredentialBindingMutation) {
      return [{ fetching: false }, verifyMock];
    }
    if (doc === queryDocs.RevokeCredentialBindingMutation) {
      return [{ fetching: false }, revokeBindingMock];
    }
    if (doc === queryDocs.CreateServicePrincipalMutation) {
      return [{ fetching: false }, createPrincipalMock];
    }
    if (doc === queryDocs.RevokeServicePrincipalMutation) {
      return [{ fetching: false }, revokePrincipalMock];
    }
    return [{ fetching: false }, createBindingMock];
  },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);
vi.mock("@/lib/settings-queries", () => settingsQueryDocs);
// Dialog/AlertDialog render as controlled passthroughs so confirm buttons are
// directly clickable without Radix portal plumbing.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const gated = ({
    open,
    children,
  }: {
    open?: boolean;
    children?: React.ReactNode;
  }) => (open ? <div>{children}</div> : null);
  const content = ({ children, ...props }: { children?: React.ReactNode }) => (
    <div {...props}>{children}</div>
  );
  const actionButton = ({
    children,
    onClick,
    ...props
  }: React.ComponentProps<"button">) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  );
  return {
    ...actual,
    Dialog: gated,
    DialogContent: content,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogFooter: pass,
    AlertDialog: gated,
    AlertDialogContent: content,
    AlertDialogHeader: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogFooter: pass,
    AlertDialogCancel: actionButton,
    AlertDialogAction: actionButton,
  };
});

import { CapabilityBindingsView } from "./CapabilityBindingsView";

const CATALOG = [
  {
    id: "def-1",
    tenantId: "tenant-1",
    namespace: "github",
    class: "connection",
    slug: "github-rest",
    displayName: "GitHub REST",
    status: "active",
    createdAt: "2026-07-10T00:00:00Z",
    versions: [
      {
        id: "ver-1",
        version: 1,
        lifecycle: "admitted",
        descriptorFingerprint: "aaaa1111",
        createdAt: "2026-07-10T00:00:00Z",
      },
    ],
    admittedVersion: {
      id: "ver-1",
      version: 1,
      lifecycle: "admitted",
      descriptorFingerprint: "aaaa1111",
      admittedAt: "2026-07-11T00:00:00Z",
      operations: [],
    },
  },
];

const PRINCIPALS = [
  {
    id: "sp-1",
    slug: "billing-bot",
    displayName: "Billing Bot",
    purpose: "Invoices",
    status: "active",
    createdAt: "2026-07-10T00:00:00Z",
    revokedAt: null,
  },
  {
    id: "sp-2",
    slug: "old-bot",
    displayName: "Old Bot",
    purpose: null,
    status: "revoked",
    createdAt: "2026-06-01T00:00:00Z",
    revokedAt: "2026-07-01T00:00:00Z",
  },
];

const RECENT = new Date(Date.now() - 60_000).toISOString();
const STALE = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

const BINDINGS = [
  {
    id: "bind-ready",
    definitionVersionId: "ver-1",
    principalMode: "service",
    servicePrincipalId: "sp-1",
    subjectUserId: null,
    readiness: "ready",
    readinessEvidence: JSON.stringify({ probe: "get_user", status: "ok" }),
    lastVerifiedAt: RECENT,
    revokedAt: null,
    createdAt: "2026-07-11T00:00:00Z",
  },
  {
    id: "bind-degraded",
    definitionVersionId: "ver-1",
    principalMode: "requester",
    servicePrincipalId: null,
    subjectUserId: null,
    readiness: "degraded",
    readinessEvidence: JSON.stringify({
      probe: "get_user",
      status: "http_401",
    }),
    lastVerifiedAt: STALE,
    revokedAt: null,
    createdAt: "2026-07-11T00:00:00Z",
  },
  {
    id: "bind-pending",
    definitionVersionId: "ver-1",
    principalMode: "agent_owner",
    servicePrincipalId: null,
    subjectUserId: null,
    readiness: "pending_setup",
    readinessEvidence: null,
    lastVerifiedAt: null,
    revokedAt: null,
    createdAt: "2026-07-11T00:00:00Z",
  },
  {
    id: "bind-revoked",
    definitionVersionId: "ver-1",
    principalMode: "requester",
    servicePrincipalId: null,
    subjectUserId: null,
    readiness: "revoked",
    readinessEvidence: JSON.stringify({ probe: "get_user", status: "ok" }),
    lastVerifiedAt: STALE,
    revokedAt: "2026-07-12T00:00:00Z",
    createdAt: "2026-07-11T00:00:00Z",
  },
];

function populate() {
  queryState.bindings = {
    data: { capabilityCredentialBindings: BINDINGS },
    fetching: false,
    error: undefined,
  };
  queryState.principals = {
    data: { tenantServicePrincipals: PRINCIPALS },
    fetching: false,
    error: undefined,
  };
  queryState.catalog = {
    data: { capabilityRuntimeCatalog: CATALOG },
    fetching: false,
    error: undefined,
  };
}

beforeEach(() => {
  queryState.bindings = {
    data: undefined,
    fetching: false,
    error: undefined,
  };
  queryState.principals = {
    data: { tenantServicePrincipals: [] },
    fetching: false,
    error: undefined,
  };
  queryState.catalog = {
    data: { capabilityRuntimeCatalog: [] },
    fetching: false,
    error: undefined,
  };
  queryState.members = {
    data: { tenantMembers: [] },
    fetching: false,
    error: undefined,
  };
  for (const mock of [
    refetchBindingsMock,
    refetchPrincipalsMock,
    verifyMock,
    revokeBindingMock,
    createPrincipalMock,
    revokePrincipalMock,
    createBindingMock,
    toastMock.success,
    toastMock.error,
  ]) {
    mock.mockReset();
  }
});
afterEach(() => {
  cleanup();
});

describe("CapabilityBindingsView", () => {
  it("renders the loading skeleton while fetching", () => {
    queryState.bindings = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    expect(screen.getByTestId("bindings-loading")).toBeTruthy();
  });

  it("renders the error state and retries both reads", () => {
    queryState.bindings = {
      data: undefined,
      fetching: false,
      error: { message: "db down" },
    };
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    expect(screen.getByTestId("bindings-error").textContent).toContain(
      "db down",
    );
    fireEvent.click(screen.getByTestId("bindings-retry"));
    expect(refetchBindingsMock).toHaveBeenCalled();
    expect(refetchPrincipalsMock).toHaveBeenCalled();
  });

  it("renders first-use empty states for bindings and principals", () => {
    queryState.bindings = {
      data: { capabilityCredentialBindings: [] },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    expect(
      screen.getByText(/No credential bindings yet/).textContent,
    ).toBeTruthy();
    expect(screen.getByText(/No service principals/)).toBeTruthy();
  });

  it("groups rows under the catalog version label with principal identity", () => {
    populate();
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    expect(screen.getByTestId("bindings-group-ver-1").textContent).toContain(
      "GitHub REST v1",
    );
    // Service binding shows the service principal's display name.
    expect(screen.getByTestId("binding-row-bind-ready").textContent).toContain(
      "Billing Bot",
    );
  });

  it("announces readiness with icon + verbatim label, never color alone", () => {
    populate();
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    for (const readiness of ["ready", "degraded", "pending_setup", "revoked"]) {
      const chip = screen.getByTestId(`binding-readiness-${readiness}`);
      // Verbatim readiness label as text…
      expect(chip.textContent).toContain(readiness);
      // …plus a non-color glyph.
      expect(chip.querySelector("svg")).toBeTruthy();
    }
  });

  it("shows redacted evidence, never-verified, and stale-evidence states", () => {
    populate();
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    // Redacted probe evidence summary for the degraded row.
    expect(
      screen.getByTestId("binding-evidence-bind-degraded").textContent,
    ).toContain("http_401");
    // Never verified = partial state on the pending row.
    expect(
      screen.getByTestId("binding-never-verified-bind-pending"),
    ).toBeTruthy();
    // Old evidence on a live binding is flagged stale; the revoked row isn't.
    expect(screen.getByTestId("binding-stale-bind-degraded")).toBeTruthy();
    expect(screen.queryByTestId("binding-stale-bind-revoked")).toBeNull();
  });

  it("offers exactly one remediation action per row (Verify vs Revoke, none when revoked)", () => {
    populate();
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    // Ready → Revoke only.
    expect(screen.getByTestId("binding-revoke-bind-ready")).toBeTruthy();
    expect(screen.queryByTestId("binding-verify-bind-ready")).toBeNull();
    // Degraded / pending → Verify only.
    expect(screen.getByTestId("binding-verify-bind-degraded")).toBeTruthy();
    expect(screen.queryByTestId("binding-revoke-bind-degraded")).toBeNull();
    expect(screen.getByTestId("binding-verify-bind-pending")).toBeTruthy();
    // Revoked = terminal, no actions.
    expect(screen.queryByTestId("binding-verify-bind-revoked")).toBeNull();
    expect(screen.queryByTestId("binding-revoke-bind-revoked")).toBeNull();
  });

  it("hides remediation and creation actions without operator rights", () => {
    populate();
    render(<CapabilityBindingsView tenantId="tenant-1" canManage={false} />);
    expect(screen.queryByTestId("binding-verify-bind-degraded")).toBeNull();
    expect(screen.queryByTestId("binding-revoke-bind-ready")).toBeNull();
    expect(screen.queryByTestId("open-new-service-principal")).toBeNull();
    expect(
      screen.queryByTestId("service-principal-revoke-billing-bot"),
    ).toBeNull();
    // Readiness stays readable for everyone.
    expect(screen.getByTestId("binding-readiness-degraded")).toBeTruthy();
  });

  it("verifies a binding and refetches on the applied outcome", async () => {
    populate();
    verifyMock.mockResolvedValue({
      data: {
        verifyCredentialBinding: {
          outcome: "applied",
          binding: { id: "bind-degraded", readiness: "ready" },
        },
      },
    });
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    fireEvent.click(screen.getByTestId("binding-verify-bind-degraded"));
    await waitFor(() =>
      expect(verifyMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        bindingId: "bind-degraded",
      }),
    );
    await waitFor(() =>
      expect(refetchBindingsMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      }),
    );
  });

  it("surfaces the safe reason when verification is rejected", async () => {
    populate();
    verifyMock.mockResolvedValue({
      data: {
        verifyCredentialBinding: {
          outcome: "rejected",
          reason: "no probe declared for this version",
        },
      },
    });
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    fireEvent.click(screen.getByTestId("binding-verify-bind-degraded"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(refetchBindingsMock).not.toHaveBeenCalled();
  });

  it("revokes a ready binding through the confirm dialog", async () => {
    populate();
    revokeBindingMock.mockResolvedValue({
      data: { revokeCredentialBinding: { outcome: "applied" } },
    });
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    fireEvent.click(screen.getByTestId("binding-revoke-bind-ready"));
    fireEvent.click(screen.getByTestId("binding-revoke-confirm"));
    await waitFor(() =>
      expect(revokeBindingMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        bindingId: "bind-ready",
      }),
    );
    await waitFor(() => expect(refetchBindingsMock).toHaveBeenCalled());
  });

  it("lists service principals with status and revokes through the confirm dialog", async () => {
    populate();
    revokePrincipalMock.mockResolvedValue({
      data: { revokeServicePrincipal: { outcome: "applied" } },
    });
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    expect(
      screen.getByTestId("service-principal-row-billing-bot").textContent,
    ).toContain("active");
    expect(
      screen.getByTestId("service-principal-row-old-bot").textContent,
    ).toContain("revoked");
    // Revoked principals carry no revoke action.
    expect(screen.queryByTestId("service-principal-revoke-old-bot")).toBeNull();
    fireEvent.click(screen.getByTestId("service-principal-revoke-billing-bot"));
    fireEvent.click(screen.getByTestId("service-principal-revoke-confirm"));
    await waitFor(() =>
      expect(revokePrincipalMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        servicePrincipalId: "sp-1",
      }),
    );
    await waitFor(() => expect(refetchPrincipalsMock).toHaveBeenCalled());
  });

  it("creates a service principal from the dialog", async () => {
    populate();
    createPrincipalMock.mockResolvedValue({
      data: {
        createServicePrincipal: {
          outcome: "applied",
          servicePrincipal: { id: "sp-3", slug: "new-bot", status: "active" },
        },
      },
    });
    render(<CapabilityBindingsView tenantId="tenant-1" canManage />);
    fireEvent.click(screen.getByTestId("open-new-service-principal"));
    fireEvent.change(screen.getByTestId("principal-slug-input"), {
      target: { value: "new-bot" },
    });
    fireEvent.change(screen.getByTestId("principal-name-input"), {
      target: { value: "New Bot" },
    });
    fireEvent.click(screen.getByTestId("principal-create-confirm"));
    await waitFor(() =>
      expect(createPrincipalMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          slug: "new-bot",
          displayName: "New Bot",
          purpose: null,
        },
      }),
    );
    await waitFor(() => expect(refetchPrincipalsMock).toHaveBeenCalled());
  });
});
