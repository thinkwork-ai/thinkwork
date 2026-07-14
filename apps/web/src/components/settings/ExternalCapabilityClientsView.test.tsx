/**
 * ExternalCapabilityClientsView tests (THINK-280 U8).
 *
 * Mirrors the CapabilityBindingsView.test.tsx mock pattern: hoisted query
 * doc symbols, a urql mock keyed on those symbols, and @thinkwork/ui
 * Dialog/AlertDialog rendered as controlled passthroughs so the reveal-once
 * secret dialog is directly assertable without Radix portal plumbing. Plain
 * vitest matchers (this repo has no jest-dom).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const {
  queryState,
  refetchClientsMock,
  createClientMock,
  rotateClientMock,
  revokeClientMock,
  toastMock,
  queryDocs,
} = vi.hoisted(() => ({
  queryState: {
    clients: {
      data: { externalCapabilityClients: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    principals: {
      data: { tenantServicePrincipals: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchClientsMock: vi.fn(),
  createClientMock: vi.fn(),
  rotateClientMock: vi.fn(),
  revokeClientMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  queryDocs: {
    ExternalCapabilityClientsQuery: Symbol("externalClients"),
    TenantServicePrincipalsQuery: Symbol("servicePrincipals"),
    CreateExternalCapabilityClientMutation: Symbol("createExternalClient"),
    RotateExternalCapabilityClientMutation: Symbol("rotateExternalClient"),
    RevokeExternalCapabilityClientMutation: Symbol("revokeExternalClient"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.ExternalCapabilityClientsQuery) {
      return [queryState.clients, refetchClientsMock];
    }
    if (query === queryDocs.TenantServicePrincipalsQuery) {
      return [queryState.principals, vi.fn()];
    }
    throw new Error("unexpected query");
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.CreateExternalCapabilityClientMutation) {
      return [{ fetching: false }, createClientMock];
    }
    if (doc === queryDocs.RotateExternalCapabilityClientMutation) {
      return [{ fetching: false }, rotateClientMock];
    }
    return [{ fetching: false }, revokeClientMock];
  },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);
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
  };
});

import { ExternalCapabilityClientsView } from "./ExternalCapabilityClientsView";

function resetState() {
  queryState.clients.data = { externalCapabilityClients: [] };
  queryState.clients.fetching = false;
  queryState.principals.data = { tenantServicePrincipals: [] };
  createClientMock.mockReset();
  rotateClientMock.mockReset();
  revokeClientMock.mockReset();
  refetchClientsMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
}

afterEach(() => {
  cleanup();
  resetState();
});

describe("ExternalCapabilityClientsView", () => {
  it("renders the first-use empty state", () => {
    render(<ExternalCapabilityClientsView tenantId="t1" canManage />);
    expect(screen.getByText("No external clients yet.")).toBeTruthy();
  });

  it("lists a client with its status and permitted scope", () => {
    queryState.clients.data = {
      externalCapabilityClients: [
        {
          id: "row-1",
          clientId: "cap_abc123",
          servicePrincipalId: "sp-1",
          allowedScopes: ["capabilities:search"],
          status: "active",
        },
      ],
    };
    render(<ExternalCapabilityClientsView tenantId="t1" canManage />);
    expect(screen.getByText("cap_abc123")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    const rows = screen.getAllByTestId("external-client-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toMatch(/capabilities:search/);
  });

  it("disables New client when there is no active service principal to bind", () => {
    queryState.principals.data = { tenantServicePrincipals: [] };
    render(<ExternalCapabilityClientsView tenantId="t1" canManage />);
    const open = screen.getByTestId(
      "external-client-create-open",
    ) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
  });

  it("hides management actions for non-operators", () => {
    queryState.clients.data = {
      externalCapabilityClients: [
        {
          id: "row-1",
          clientId: "cap_abc123",
          servicePrincipalId: "sp-1",
          allowedScopes: ["capabilities:search"],
          status: "active",
        },
      ],
    };
    render(<ExternalCapabilityClientsView tenantId="t1" canManage={false} />);
    expect(screen.queryByTestId("external-client-create-open")).toBeNull();
    expect(screen.queryByTestId("external-client-rotate")).toBeNull();
    expect(screen.queryByTestId("external-client-revoke")).toBeNull();
  });
});
