/**
 * Evidence panel tests (THINK-320 U6): AE2 — focusing a candidate renders
 * verbatim quotes plus approve/edit/reject without leaving the canvas;
 * single-candidate approve rides the R15 exclusion mechanism; item-level
 * reject fires the fingerprint-writing rejectOntologyChangeSetItem
 * mutation (R13); approved-type focus shows founding evidence (R6) and
 * empty-evidence pack/baseline types show a provenance line instead.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, approveMock, rejectItemMock, queryDocs } = vi.hoisted(
  () => ({
    queryState: {
      changeSets: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
      definitions: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    approveMock: vi.fn(),
    rejectItemMock: vi.fn(),
    queryDocs: {
      SettingsOntologyChangeSetsQuery: Symbol("changeSets"),
      SettingsKnowledgeGraphOntologyQuery: Symbol("definitions"),
      SettingsApproveOntologyChangeSetMutation: Symbol("approve"),
      SettingsRejectOntologyChangeSetItemMutation: Symbol("rejectItem"),
    },
  }),
);

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsOntologyChangeSetsQuery) {
      return [queryState.changeSets, vi.fn()];
    }
    if (query === queryDocs.SettingsKnowledgeGraphOntologyQuery) {
      return [queryState.definitions, vi.fn()];
    }
    throw new Error("unexpected query");
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsApproveOntologyChangeSetMutation) {
      return [{ fetching: false }, approveMock];
    }
    if (doc === queryDocs.SettingsRejectOntologyChangeSetItemMutation) {
      return [{ fetching: false }, rejectItemMock];
    }
    throw new Error("unexpected mutation");
  },
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
// Sheet chrome renders as plain wrappers so the panel content is reachable
// without a Radix Dialog root (the host owns the real Sheet).
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    SheetHeader: pass,
    SheetTitle: pass,
    SheetDescription: pass,
  };
});
import React from "react";

import { OntologyCandidateSheet } from "./OntologyCandidateSheet";

afterEach(cleanup);

const ITEM = {
  id: "item-1",
  changeSetId: "set-1",
  itemType: "ENTITY_TYPE",
  action: "CREATE",
  status: "PENDING_REVIEW",
  targetSlug: "work_order",
  title: "Add work order",
  description: null,
  proposedValue: {
    slug: "work_order",
    name: "Work Order",
    description: "A unit of scheduled field work.",
  },
  editedValue: null,
  confidence: 0.9,
  updatedAt: "2026-07-18T12:00:00.000Z",
  evidenceExamples: [
    {
      id: "ev-1",
      sourceKind: "thread",
      sourceRef: null,
      sourceLabel: "Dispatch thread",
      quote: "Create a work order for the Hendricks site.",
      observedAt: "2026-07-17T09:00:00.000Z",
    },
    {
      id: "ev-2",
      sourceKind: "thread",
      sourceRef: null,
      sourceLabel: null,
      quote: "Work order 118 slipped again.",
      observedAt: null,
    },
  ],
};

const OTHER_PENDING_ITEM = {
  ...ITEM,
  id: "item-2",
  targetSlug: "crew",
  proposedValue: { slug: "crew", name: "Crew" },
  evidenceExamples: [],
};

const SETTLED_ITEM = {
  ...ITEM,
  id: "item-3",
  status: "APPROVED",
  targetSlug: "site",
  proposedValue: { slug: "site", name: "Site" },
  evidenceExamples: [
    {
      id: "ev-3",
      sourceKind: "thread",
      sourceRef: null,
      sourceLabel: "Founding thread",
      quote: "Sites are where crews show up.",
      observedAt: null,
    },
  ],
};

const CHANGE_SETS = [
  {
    id: "set-1",
    title: "Scan results",
    summary: null,
    status: "PENDING_REVIEW",
    proposedBy: "suggestion_engine",
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    items: [ITEM, OTHER_PENDING_ITEM],
  },
  {
    id: "set-0",
    title: "Earlier approval",
    summary: null,
    status: "APPROVED",
    proposedBy: "user",
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-11T12:00:00.000Z",
    items: [SETTLED_ITEM],
  },
];

const DEFINITIONS = {
  entityTypes: [
    {
      id: "type-site",
      slug: "site",
      name: "Site",
      description: "A customer location.",
      broadType: "place",
      aliases: ["location"],
      lifecycleStatus: "APPROVED",
      externalMappings: [],
    },
    {
      id: "type-pack",
      slug: "invoice",
      name: "Invoice",
      description: "Billing document.",
      broadType: "document",
      aliases: [],
      lifecycleStatus: "APPROVED",
      externalMappings: [],
    },
  ],
  relationshipTypes: [],
  externalMappings: [],
  activeVersion: { id: "v1", versionNumber: 3, status: "active" },
};

const candidateFocus = {
  kind: "candidate" as const,
  itemId: "item-1",
  changeSetId: "set-1",
  label: "Work Order",
};

describe("OntologyCandidateSheet", () => {
  beforeEach(() => {
    approveMock.mockReset();
    rejectItemMock.mockReset();
    queryState.changeSets = {
      data: { ontologyChangeSets: CHANGE_SETS },
      fetching: false,
      error: undefined,
    };
    queryState.definitions = {
      data: { ontologyDefinitions: DEFINITIONS },
      fetching: false,
      error: undefined,
    };
  });

  it("renders verbatim evidence quotes with approve/edit/reject (AE2)", () => {
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={vi.fn()}
        onActionComplete={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Create a work order for the Hendricks site."),
    ).toBeTruthy();
    expect(screen.getByText("Work order 118 slipped again.")).toBeTruthy();
    expect(screen.getByText("Evidence (2)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("approves a single candidate by excluding the other pending items as DEFERRED (R15)", async () => {
    approveMock.mockResolvedValue({ data: {}, error: undefined });
    const onActionComplete = vi.fn();
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={vi.fn()}
        onActionComplete={onActionComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          changeSetId: "set-1",
          excludedItemIds: ["item-2"],
          excludedDisposition: "DEFERRED",
        },
      });
    });
    await waitFor(() => expect(onActionComplete).toHaveBeenCalled());
  });

  it("fires the fingerprint-writing item reject mutation (R13)", async () => {
    rejectItemMock.mockResolvedValue({ data: {}, error: undefined });
    const onActionComplete = vi.fn();
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={vi.fn()}
        onActionComplete={onActionComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(rejectItemMock).toHaveBeenCalledWith({
        input: { tenantId: "tenant-1", itemId: "item-1" },
      });
    });
    await waitFor(() => expect(onActionComplete).toHaveBeenCalled());
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("surfaces approval failures inline and keeps the panel open", async () => {
    approveMock.mockResolvedValue({
      data: undefined,
      error: { message: "referenced type is excluded from this approval" },
    });
    const onActionComplete = vi.fn();
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={vi.fn()}
        onActionComplete={onActionComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "referenced type is excluded",
      );
    });
    expect(onActionComplete).not.toHaveBeenCalled();
  });

  it("hands the candidate to the shared form editor on Edit (KTD-9)", () => {
    const onEdit = vi.fn();
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={onEdit}
        onActionComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledWith({
      id: "item-1",
      changeSetId: "set-1",
      itemType: "ENTITY_TYPE",
      updatedAt: "2026-07-18T12:00:00.000Z",
      value: expect.objectContaining({ slug: "work_order" }),
    });
  });

  it("shows an approved type's definition and founding evidence (R6)", () => {
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={{ kind: "type", slug: "site", name: "Site" }}
        onEdit={vi.fn()}
        onActionComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("A customer location.")).toBeTruthy();
    expect(screen.getByText("Sites are where crews show up.")).toBeTruthy();
    expect(screen.queryByTestId("provenance-line")).toBeNull();
  });

  it("shows a provenance line for pack/baseline types with no founding evidence", () => {
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={{ kind: "type", slug: "invoice", name: "Invoice" }}
        onEdit={vi.fn()}
        onActionComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId("provenance-line").textContent).toContain(
      "Installed from a pack or the platform baseline",
    );
  });

  it("explains when a focused candidate is no longer pending", () => {
    queryState.changeSets = {
      data: { ontologyChangeSets: [] },
      fetching: false,
      error: undefined,
    };
    render(
      <OntologyCandidateSheet
        tenantId="tenant-1"
        focus={candidateFocus}
        onEdit={vi.fn()}
        onActionComplete={vi.fn()}
      />,
    );

    expect(screen.getByText(/no longer pending/)).toBeTruthy();
  });
});
