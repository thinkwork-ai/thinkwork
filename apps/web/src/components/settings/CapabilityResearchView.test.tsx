/**
 * Research view tests (THINK-280 U2): connection research + admission.
 * Covers the idle/loading/error/degraded/populated states, the visually
 * distinct non-executable proposal rows with provenance URLs, the exact-
 * fingerprint admit review (single-use), reject with reason, the operator
 * gate on Admit, and focus return to the originating row action.
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

const { queryState, refetchMock, admitMock, rejectMock, toastMock, queryDocs } =
  vi.hoisted(() => ({
    queryState: {
      research: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    refetchMock: vi.fn(),
    admitMock: vi.fn(),
    rejectMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    queryDocs: {
      ConnectionResearchQuery: Symbol("connectionResearch"),
      AdmitConnectionProposalMutation: Symbol("admitProposal"),
      RejectConnectionProposalMutation: Symbol("rejectProposal"),
    },
  }));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.ConnectionResearchQuery) {
      return [queryState.research, refetchMock];
    }
    throw new Error("unexpected query");
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.AdmitConnectionProposalMutation) {
      return [{ fetching: false }, admitMock];
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

import { CapabilityResearchView } from "./CapabilityResearchView";

const RESEARCH = {
  state: "ok",
  stateDetail: null,
  definitions: [
    {
      id: "def-1",
      namespace: "github",
      class: "connection",
      slug: "github-rest",
      displayName: "GitHub REST",
      status: "active",
      admittedVersion: {
        id: "ver-1",
        version: 1,
        descriptorFingerprint: "aaaa1111",
      },
    },
  ],
  proposals: [
    {
      id: "prop-1",
      definitionId: null,
      payload: JSON.stringify({ slug: "github-rest", operations: [] }),
      payloadFingerprint: "ffff9999eeee8888",
      provenance: JSON.stringify({
        sourceUrls: ["https://docs.github.com/en/rest"],
      }),
      status: "submitted",
      createdByActorType: "agent",
      decidedAt: null,
      createdAt: "2026-07-12T00:00:00Z",
    },
  ],
};

function searchFor(term: string) {
  fireEvent.change(screen.getByTestId("research-query-input"), {
    target: { value: term },
  });
  fireEvent.click(screen.getByTestId("research-submit"));
}

beforeEach(() => {
  queryState.research = { data: undefined, fetching: false, error: undefined };
  refetchMock.mockReset();
  admitMock.mockReset();
  rejectMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("CapabilityResearchView", () => {
  it("renders the first-use idle state before any search", () => {
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    expect(screen.getByTestId("research-idle")).toBeTruthy();
  });

  it("renders the loading skeleton for an in-flight search", () => {
    queryState.research = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    const { container } = render(
      <CapabilityResearchView tenantId="tenant-1" canAdmit />,
    );
    fireEvent.change(screen.getByTestId("research-query-input"), {
      target: { value: "github" },
    });
    // The submit button is disabled while fetching; submit the form directly.
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByTestId("research-loading")).toBeTruthy();
  });

  it("renders the error state and retries", () => {
    queryState.research = {
      data: undefined,
      fetching: false,
      error: { message: "discovery blew up" },
    };
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    expect(screen.getByTestId("research-error").textContent).toContain(
      "discovery blew up",
    );
    fireEvent.click(screen.getByTestId("research-retry"));
    expect(refetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("shows the degraded banner with detail while stored results stay usable", () => {
    queryState.research = {
      data: {
        connectionResearch: {
          ...RESEARCH,
          state: "degraded",
          stateDetail: "integrations.sh timed out",
        },
      },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    expect(screen.getByTestId("research-degraded").textContent).toContain(
      "integrations.sh timed out",
    );
    // Admitted results still render — degradation never hides them.
    expect(screen.getByTestId("research-definition-github-rest")).toBeTruthy();
  });

  it("renders working definitions and visually distinct non-executable proposals with source URLs", () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    expect(
      screen.getByTestId("research-definition-github-rest").textContent,
    ).toContain("admitted v1");
    const proposal = screen.getByTestId("research-proposal-prop-1");
    expect(proposal.textContent).toContain("non-executable");
    const link = proposal.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://docs.github.com/en/rest");
  });

  it("renders empty-result states for a query with no matches", () => {
    queryState.research = {
      data: {
        connectionResearch: {
          ...RESEARCH,
          definitions: [],
          proposals: [],
        },
      },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("nothing-matches");
    expect(screen.getByTestId("research-definitions-empty")).toBeTruthy();
    expect(screen.getByTestId("research-proposals-empty")).toBeTruthy();
  });

  it("admits through the review dialog with the exact reviewed fingerprint", async () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    admitMock.mockResolvedValue({
      data: { admitConnectionProposal: { outcome: "applied" } },
    });
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    fireEvent.click(screen.getByTestId("proposal-admit-prop-1"));
    // The review dialog shows payload + sources before the decision.
    expect(screen.getByTestId("proposal-admit-dialog")).toBeTruthy();
    expect(screen.getByTestId("proposal-payload").textContent).toContain(
      "github-rest",
    );
    fireEvent.click(screen.getByTestId("proposal-admit-confirm"));
    await waitFor(() =>
      expect(admitMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          proposalId: "prop-1",
          reviewedFingerprint: "ffff9999eeee8888",
        },
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(refetchMock).toHaveBeenCalled();
  });

  it("surfaces the safe rejection reason verbatim when admission is rejected", async () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    admitMock.mockResolvedValue({
      data: {
        admitConnectionProposal: {
          outcome: "rejected",
          reason: "payload changed since review — re-review required",
        },
      },
    });
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    fireEvent.click(screen.getByTestId("proposal-admit-prop-1"));
    fireEvent.click(screen.getByTestId("proposal-admit-confirm"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "payload changed since review — re-review required",
      ),
    );
  });

  it("rejects with an operator reason", async () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    rejectMock.mockResolvedValue({
      data: { rejectConnectionProposal: { outcome: "applied" } },
    });
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    fireEvent.click(screen.getByTestId("proposal-reject-prop-1"));
    fireEvent.change(screen.getByTestId("proposal-reject-reason"), {
      target: { value: "unofficial sources only" },
    });
    fireEvent.click(screen.getByTestId("proposal-reject-confirm"));
    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        proposalId: "prop-1",
        reason: "unofficial sources only",
      }),
    );
  });

  it("hides Admit for non-admins but keeps Reject", () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit={false} />);
    searchFor("github");
    expect(screen.queryByTestId("proposal-admit-prop-1")).toBeNull();
    expect(screen.getByTestId("proposal-reject-prop-1")).toBeTruthy();
  });

  it("returns keyboard focus to the originating row action after the review closes", async () => {
    queryState.research = {
      data: { connectionResearch: RESEARCH },
      fetching: false,
      error: undefined,
    };
    admitMock.mockResolvedValue({
      data: { admitConnectionProposal: { outcome: "applied" } },
    });
    render(<CapabilityResearchView tenantId="tenant-1" canAdmit />);
    searchFor("github");
    const trigger = screen.getByTestId("proposal-admit-prop-1");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("proposal-admit-confirm"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
