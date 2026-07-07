/**
 * THINK-208 U6 test scenarios: explanatory empty state, cross-member share
 * visibility for operators, and the confirm-then-revoke-then-refetch flow.
 * (Operator gating itself lives in the parent layout route's OperatorGuard.)
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revokeMock, queryState, reexecuteMock, queryDocs } = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  queryState: {
    data: undefined as unknown,
    fetching: false,
    error: undefined as unknown,
  },
  reexecuteMock: vi.fn(),
  queryDocs: {
    RevokeArtifactShareLinkMutation: Symbol("Revoke"),
    TenantArtifactSharesQuery: Symbol("TenantShares"),
  },
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, revokeMock],
  useQuery: () => [queryState, reexecuteMock],
}));
vi.mock("@/lib/graphql-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a {...(props as object)}>{children}</a>,
}));

import { SettingsArtifactSharesBody } from "./SettingsArtifactShares";

const SHARES = [
  {
    id: "share-1",
    artifactId: "art-1",
    artifactTitle: "Q2 Review",
    createdBy: "user-1",
    createdByName: "Alice",
    createdAt: "2026-07-06T00:00:00Z",
  },
  {
    id: "share-2",
    artifactId: "art-2",
    artifactTitle: "Board Brief",
    createdBy: "user-2",
    createdByName: "Bob",
    createdAt: "2026-07-05T00:00:00Z",
  },
];

beforeEach(() => {
  revokeMock.mockReset();
  reexecuteMock.mockReset();
  queryState.data = undefined;
  queryState.fetching = false;
  queryState.error = undefined;
});
afterEach(cleanup);

describe("SettingsArtifactSharesBody", () => {
  it("renders the explanatory empty state instead of a bare table", () => {
    queryState.data = { tenantArtifactShares: [] };
    render(<SettingsArtifactSharesBody />);
    expect(screen.getByTestId("shares-empty-state")).toBeTruthy();
    expect(screen.queryByTestId("shares-table")).toBeNull();
    expect(screen.getByText(/Share action/i)).toBeTruthy();
  });

  it("shows shares created by other members (AE4 operator half)", () => {
    queryState.data = { tenantArtifactShares: SHARES };
    render(<SettingsArtifactSharesBody />);
    expect(screen.getByText("Q2 Review")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Board Brief")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("revoke requires confirmation, then revokes and refetches", async () => {
    queryState.data = { tenantArtifactShares: SHARES };
    revokeMock.mockResolvedValue({ data: { revokeArtifactShareLink: true } });
    render(<SettingsArtifactSharesBody />);

    fireEvent.click(screen.getByTestId("share-revoke-share-2"));
    expect(revokeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("shares-revoke-dialog")).toBeTruthy();
    expect(screen.getByText(/loses access immediately/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId("shares-revoke-confirm"));
    await waitFor(() => {
      expect(revokeMock).toHaveBeenCalledWith({ shareId: "share-2" });
    });
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("cancelling the confirmation fires no mutation", async () => {
    queryState.data = { tenantArtifactShares: SHARES };
    render(<SettingsArtifactSharesBody />);
    fireEvent.click(screen.getByTestId("share-revoke-share-1"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("shares-revoke-dialog")).toBeNull();
    });
    expect(revokeMock).not.toHaveBeenCalled();
  });
});
