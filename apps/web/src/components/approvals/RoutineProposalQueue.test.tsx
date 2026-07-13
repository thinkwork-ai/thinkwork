/**
 * Pending Routine promotion queue tests (THINK-280 U6): submitted proposals
 * have no inbox row, so the approvals surface lists them straight from
 * routineProposals(status: "submitted"). Covers loading, error, hidden-when-
 * empty, and populated rows linking to /approvals/<proposalId>.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, queryDocs } = vi.hoisted(() => ({
  queryState: {
    proposals: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  queryDocs: {
    RoutineProposalsQuery: Symbol("routineProposals"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.RoutineProposalsQuery) {
      return [queryState.proposals, vi.fn()];
    }
    throw new Error("unexpected query");
  },
}));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);

import { RoutineProposalQueue } from "./RoutineProposalQueue";

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    tenantId: "tenant-1",
    routineId: "routine-1",
    payloadFingerprint: "fp-original-aaaa1111",
    status: "submitted",
    approvalMode: null,
    inboxItemId: null,
    createdByActorType: "agent",
    decidedAt: null,
    promotedCommitSha: null,
    createdAt: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  queryState.proposals = {
    data: undefined,
    fetching: false,
    error: undefined,
  };
});
afterEach(cleanup);

describe("RoutineProposalQueue", () => {
  it("renders a loading state while proposals are in flight", () => {
    queryState.proposals = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    render(<RoutineProposalQueue tenantId="tenant-1" />);
    expect(screen.getByTestId("routine-proposal-queue-loading")).toBeTruthy();
  });

  it("renders the error state", () => {
    queryState.proposals = {
      data: undefined,
      fetching: false,
      error: { message: "boom" },
    };
    render(<RoutineProposalQueue tenantId="tenant-1" />);
    expect(
      screen.getByTestId("routine-proposal-queue-error").textContent,
    ).toContain("boom");
  });

  it("renders nothing when there are no pending proposals", () => {
    queryState.proposals = {
      data: { routineProposals: [] },
      fetching: false,
      error: undefined,
    };
    const { container } = render(<RoutineProposalQueue tenantId="tenant-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing without a tenant", () => {
    const { container } = render(<RoutineProposalQueue tenantId={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists pending proposals as links to the approval detail route", () => {
    queryState.proposals = {
      data: {
        routineProposals: [
          proposalRow(),
          proposalRow({ id: "prop-2", routineId: null }),
        ],
      },
      fetching: false,
      error: undefined,
    };
    render(<RoutineProposalQueue tenantId="tenant-1" selectedId="prop-1" />);
    const row = screen.getByTestId("routine-proposal-queue-row-prop-1");
    expect(row.getAttribute("href")).toBe("/approvals/prop-1");
    expect(row.textContent).toContain("Routine update promotion");
    // Short display form = first 12 chars of the fingerprint.
    expect(row.textContent).toContain("fingerprint fp-original-");
    const newRoutineRow = screen.getByTestId(
      "routine-proposal-queue-row-prop-2",
    );
    expect(newRoutineRow.textContent).toContain("New Routine promotion");
  });
});
