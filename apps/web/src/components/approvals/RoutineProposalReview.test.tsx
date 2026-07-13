/**
 * Routine promotion proposal review tests (THINK-280 U6). Covers the
 * loading/error/not-found states, the populated bundle render (source,
 * dependency contracts, fixtures, invariants, principal/effect,
 * fingerprint), exact-fingerprint-at-open approval, the stale-fingerprint
 * mid-review guard (Approve disabled + notice + refresh re-capture),
 * operator- vs repair-approved decisions, the promotion verdict, reject
 * with reason, focus return to the originating action, and the inbox-item
 * routing helper.
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
  refetchMock,
  approveMock,
  rejectMock,
  toastMock,
  queryDocs,
} = vi.hoisted(() => ({
  queryState: {
    proposal: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  queryDocs: {
    RoutineProposalQuery: Symbol("routineProposal"),
    RoutineProposalsQuery: Symbol("routineProposals"),
    ApproveRoutineProposalMutation: Symbol("approveRoutineProposal"),
    RejectRoutineProposalMutation: Symbol("rejectRoutineProposal"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.RoutineProposalQuery) {
      return [queryState.proposal, refetchMock];
    }
    throw new Error("unexpected query");
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.ApproveRoutineProposalMutation) {
      return [{ fetching: false }, approveMock];
    }
    return [{ fetching: false }, rejectMock];
  },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);
// Dialogs render as controlled passthroughs so the review content is
// directly reachable without Radix portal plumbing.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    Dialog: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogFooter: pass,
  };
});

import { RoutineProposalReview } from "./RoutineProposalReview";
import { routineProposalIdOf } from "./approval-types";

const BUNDLE = {
  slug: "sync-github-issues",
  code: "def run(input):\n    return {'ok': True}\n",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  fixtures: [
    {
      path: "fixtures/happy-path.json",
      input: { repo: "thinkwork" },
      expected: { ok: true },
    },
  ],
  invariants: ["never mutates issues", "page size <= 100"],
  dependencies: [
    {
      twcap: "twcap:github/rest#issues.list",
      contractHash: "c0ntract4ash",
      definitionVersionId: "defver-1",
    },
  ],
  minimumGrants: { github: ["issues:read"] },
  principal: { mode: "service", servicePrincipalId: "sp-9" },
  effectSummary: { effect: "read", costClass: "low" },
  evidence: { brokerSessionId: "bs-1", brokerCallIds: ["bc-1"] },
};

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    tenantId: "tenant-1",
    routineId: null,
    payload: JSON.stringify(BUNDLE),
    payloadFingerprint: "fp-original-aaaa1111",
    evidenceRefs: JSON.stringify(BUNDLE.evidence),
    status: "submitted",
    approvalMode: null,
    approvalEvidence: null,
    createdByActorType: "agent",
    createdByActorId: "agent-1",
    decidedAt: null,
    decidedByUserId: null,
    promotedCommitSha: null,
    createdAt: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

function setProposal(overrides: Record<string, unknown> = {}) {
  queryState.proposal = {
    data: { routineProposal: proposalRow(overrides) },
    fetching: false,
    error: undefined,
  };
}

function renderPanel() {
  return render(
    <RoutineProposalReview proposalId="prop-1" tenantId="tenant-1" />,
  );
}

beforeEach(() => {
  queryState.proposal = { data: undefined, fetching: false, error: undefined };
  refetchMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("routineProposalIdOf", () => {
  it("routes a proposal-linked inbox item to the review panel", () => {
    expect(
      routineProposalIdOf({
        entityType: "capability_routine_proposal",
        entityId: "prop-1",
      }),
    ).toBe("prop-1");
  });

  it("leaves computer approvals and unlinked items on the existing path", () => {
    expect(
      routineProposalIdOf({ entityType: "thread", entityId: "t-1" }),
    ).toBeNull();
    expect(
      routineProposalIdOf({
        entityType: "capability_routine_proposal",
        entityId: null,
      }),
    ).toBeNull();
    expect(routineProposalIdOf(null)).toBeNull();
  });
});

describe("RoutineProposalReview", () => {
  it("renders the loading skeleton while the proposal is in flight", () => {
    queryState.proposal = { data: undefined, fetching: true, error: undefined };
    renderPanel();
    expect(screen.getByTestId("routine-proposal-loading")).toBeTruthy();
  });

  it("renders the error state and retries", () => {
    queryState.proposal = {
      data: undefined,
      fetching: false,
      error: { message: "resolver blew up" },
    };
    renderPanel();
    expect(screen.getByTestId("routine-proposal-error").textContent).toContain(
      "resolver blew up",
    );
    fireEvent.click(screen.getByTestId("routine-proposal-retry"));
    expect(refetchMock).toHaveBeenCalledWith({ requestPolicy: "network-only" });
  });

  it("renders not-found when the proposal is missing", () => {
    queryState.proposal = {
      data: { routineProposal: null },
      fetching: false,
      error: undefined,
    };
    renderPanel();
    expect(screen.getByTestId("routine-proposal-error").textContent).toContain(
      "not found",
    );
  });

  it("renders the full bundle: code, dependency contracts, fixtures, invariants, principal/effect, fingerprint", () => {
    setProposal();
    renderPanel();
    expect(screen.getByTestId("routine-proposal-code").textContent).toContain(
      "def run(input):",
    );
    const deps = screen.getByTestId("routine-proposal-dependencies");
    expect(deps.textContent).toContain("twcap:github/rest#issues.list");
    expect(deps.textContent).toContain("c0ntract4ash");
    expect(
      screen.getByTestId("routine-proposal-fixtures").textContent,
    ).toContain("fixtures/happy-path.json");
    const invariants = screen.getByTestId("routine-proposal-invariants");
    expect(invariants.textContent).toContain("never mutates issues");
    const principal = screen.getByTestId("routine-proposal-principal-effect");
    expect(principal.textContent).toContain("principal: service");
    expect(principal.textContent).toContain("effect: read");
    // Short fingerprint display = first 12 chars of the reviewed value.
    expect(screen.getByTitle("fp-original-aaaa1111")).toBeTruthy();
  });

  it("approves with exactly the fingerprint captured at panel open", async () => {
    setProposal();
    approveMock.mockResolvedValue({
      data: { approveRoutineProposal: { outcome: "applied" } },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          proposalId: "prop-1",
          reviewedFingerprint: "fp-original-aaaa1111",
        },
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(refetchMock).toHaveBeenCalled();
  });

  it("disables Approve and shows the stale notice when the live fingerprint drifts mid-review", () => {
    setProposal();
    const { rerender } = renderPanel();
    // A post-review edit supersedes the reviewed payload → new fingerprint.
    setProposal({ payloadFingerprint: "fp-changed-bbbb2222" });
    rerender(<RoutineProposalReview proposalId="prop-1" tenantId="tenant-1" />);
    expect(screen.getByTestId("routine-proposal-stale-notice")).toBeTruthy();
    const approve = screen.getByTestId(
      "routine-proposal-approve",
    ) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    // A stale approval is never sent, even if the click fires.
    fireEvent.click(approve);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("re-captures the current fingerprint on refresh and re-enables Approve", async () => {
    setProposal();
    approveMock.mockResolvedValue({
      data: { approveRoutineProposal: { outcome: "applied" } },
    });
    const { rerender } = renderPanel();
    setProposal({ payloadFingerprint: "fp-changed-bbbb2222" });
    rerender(<RoutineProposalReview proposalId="prop-1" tenantId="tenant-1" />);
    fireEvent.click(screen.getByTestId("routine-proposal-refresh"));
    expect(refetchMock).toHaveBeenCalledWith({ requestPolicy: "network-only" });
    expect(screen.queryByTestId("routine-proposal-stale-notice")).toBeNull();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          proposalId: "prop-1",
          reviewedFingerprint: "fp-changed-bbbb2222",
        },
      }),
    );
  });

  it("surfaces the safe rejection reason verbatim when the approval is rejected server-side", async () => {
    setProposal();
    approveMock.mockResolvedValue({
      data: {
        approveRoutineProposal: {
          outcome: "rejected",
          reason: "stale_fingerprint: payload changed since review",
        },
      },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "stale_fingerprint: payload changed since review",
      ),
    );
  });

  it("renders the promotion verdict (outcome, commit, validated SHA, hermetic gate) after approval", async () => {
    setProposal();
    approveMock.mockResolvedValue({
      data: {
        approveRoutineProposal: {
          outcome: "applied",
          promotionOutcome: "promoted",
          promotedCommitSha: "abc1234def",
          validatedSha: "abc1234def",
          hermetic: JSON.stringify({
            status: "green",
            fixtures: [{ path: "fixtures/happy-path.json", passed: true }],
          }),
        },
      },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    const promotion = await screen.findByTestId("routine-proposal-promotion");
    expect(promotion.textContent).toContain("promoted");
    expect(promotion.textContent).toContain("commit abc1234def");
    expect(promotion.textContent).toContain("validated abc1234def");
    expect(promotion.textContent).toContain("green");
    expect(promotion.textContent).toContain("fixtures/happy-path.json");
  });

  it("rejects with an operator reason", async () => {
    setProposal();
    rejectMock.mockResolvedValue({
      data: { rejectRoutineProposal: { outcome: "applied" } },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-reject"));
    fireEvent.change(screen.getByTestId("routine-proposal-reject-reason"), {
      target: { value: "budget too high for a read routine" },
    });
    fireEvent.click(screen.getByTestId("routine-proposal-reject-confirm"));
    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        proposalId: "prop-1",
        reason: "budget too high for a read routine",
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("omits an empty reject reason", async () => {
    setProposal();
    rejectMock.mockResolvedValue({
      data: { rejectRoutineProposal: { outcome: "applied" } },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-reject"));
    fireEvent.click(screen.getByTestId("routine-proposal-reject-confirm"));
    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        proposalId: "prop-1",
        reason: undefined,
      }),
    );
  });

  it("returns keyboard focus to the originating Reject action after the dialog closes", async () => {
    setProposal();
    rejectMock.mockResolvedValue({
      data: { rejectRoutineProposal: { outcome: "applied" } },
    });
    renderPanel();
    const trigger = screen.getByTestId("routine-proposal-reject");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("routine-proposal-reject-confirm"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("renders an operator-approved decision with the deciding user", () => {
    setProposal({
      status: "promoted",
      approvalMode: "operator",
      decidedAt: "2026-07-13T01:00:00Z",
      decidedByUserId: "user-42",
      promotedCommitSha: "abc1234def",
    });
    renderPanel();
    const decision = screen.getByTestId("routine-proposal-decision");
    expect(decision.textContent).toContain("Operator-approved");
    expect(decision.textContent).toContain("user-42");
    expect(decision.textContent).toContain("promoted commit abc1234def");
    // No approve/reject actions on a decided proposal.
    expect(screen.queryByTestId("routine-proposal-approve")).toBeNull();
  });

  it("renders a repair-approved decision as machine-approved with evidence", () => {
    setProposal({
      status: "promoted",
      approvalMode: "repair",
      decidedAt: "2026-07-13T01:00:00Z",
      decidedByUserId: null,
      approvalEvidence: JSON.stringify({
        diff: { budgets: { pageSize: [100, 50] } },
        hermetic: "green",
      }),
    });
    renderPanel();
    const decision = screen.getByTestId("routine-proposal-decision");
    expect(decision.textContent).toContain("Repair-approved (machine)");
    expect(decision.textContent).not.toContain("Operator-approved");
    expect(decision.textContent).toContain("pageSize");
  });

  it("distinguishes repair vs operator approval with an icon + label, not color alone", () => {
    setProposal({ status: "promoted", approvalMode: "repair" });
    const { unmount } = renderPanel();
    const repairMode = screen.getByTestId("routine-proposal-approval-mode");
    expect(repairMode.textContent).toContain("Repair-approved (machine)");
    expect(repairMode.querySelector("svg")).toBeTruthy();
    const repairIcon = repairMode.querySelector("svg")?.outerHTML;
    unmount();

    setProposal({
      status: "approved",
      approvalMode: "operator",
      decidedByUserId: "user-42",
    });
    renderPanel();
    const operatorMode = screen.getByTestId("routine-proposal-approval-mode");
    expect(operatorMode.textContent).toContain("Operator-approved");
    expect(operatorMode.querySelector("svg")).toBeTruthy();
    // Different glyphs, not just different colors.
    expect(operatorMode.querySelector("svg")?.outerHTML).not.toBe(repairIcon);
  });

  it("flags an unparseable payload with an explicit error notice", () => {
    setProposal({ payload: "not json {{" });
    renderPanel();
    expect(screen.getByTestId("routine-proposal-payload-error")).toBeTruthy();
    expect(screen.getByTestId("routine-proposal-code").textContent).toContain(
      "(no code in bundle)",
    );
  });
});

describe("RoutineProposalReview mid-review invalidation", () => {
  it("shows the stale notice when the proposal leaves 'submitted' mid-review", () => {
    setProposal();
    const { rerender } = renderPanel();
    // Decided or superseded elsewhere while the review was open.
    setProposal({ status: "superseded" });
    rerender(<RoutineProposalReview proposalId="prop-1" tenantId="tenant-1" />);
    const notice = screen.getByTestId("routine-proposal-stale-notice");
    expect(notice.textContent).toContain("decided or superseded");
    // No enabled Approve remains anywhere.
    expect(screen.queryByTestId("routine-proposal-approve")).toBeNull();
  });

  it("renders the stale notice when the server rejects with stale_or_decided_fingerprint", async () => {
    setProposal();
    approveMock.mockResolvedValue({
      data: {
        approveRoutineProposal: {
          outcome: "rejected",
          reason: "stale_or_decided_fingerprint",
        },
      },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    await screen.findByTestId("routine-proposal-stale-notice");
    expect(
      (screen.getByTestId("routine-proposal-approve") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith(
      "stale_or_decided_fingerprint",
    );
  });

  it("re-reads the proposal on an interval and on window focus while a decision is possible", () => {
    vi.useFakeTimers();
    try {
      setProposal();
      renderPanel();
      expect(refetchMock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(refetchMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
      const calls = refetchMock.mock.calls.length;
      fireEvent(window, new Event("focus"));
      expect(refetchMock.mock.calls.length).toBe(calls + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the proposal is decided", () => {
    vi.useFakeTimers();
    try {
      setProposal({ status: "promoted", approvalMode: "operator" });
      renderPanel();
      vi.advanceTimersByTime(30_000);
      fireEvent(window, new Event("focus"));
      expect(refetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RoutineProposalReview promotion outcomes", () => {
  async function approveWith(result: Record<string, unknown>) {
    setProposal();
    approveMock.mockResolvedValue({
      data: { approveRoutineProposal: { outcome: "applied", ...result } },
    });
    renderPanel();
    fireEvent.click(screen.getByTestId("routine-proposal-approve"));
    return screen.findByTestId("routine-proposal-promotion-detail");
  }

  it("explains validation_failed with the hermetic fixture detail", async () => {
    const detail = await approveWith({
      promotionOutcome: "validation_failed",
      hermetic: JSON.stringify({
        status: "red",
        fixtures: [
          {
            path: "fixtures/happy-path.json",
            passed: false,
            detail: "mismatch",
          },
        ],
      }),
    });
    expect(detail.textContent).toContain("NOT promoted");
    const promotion = screen.getByTestId("routine-proposal-promotion");
    expect(promotion.textContent).toContain("red");
    expect(promotion.textContent).toContain("mismatch");
  });

  it("explains commit_conflict as retryable", async () => {
    const detail = await approveWith({ promotionOutcome: "commit_conflict" });
    expect(detail.textContent).toContain("retryable");
  });

  it("explains an unexpected promotion error", async () => {
    const detail = await approveWith({ promotionOutcome: "error" });
    expect(detail.textContent).toContain("unexpected error");
  });
});
