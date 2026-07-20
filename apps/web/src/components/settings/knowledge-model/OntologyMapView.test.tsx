/**
 * Living Map host tests (THINK-320 U6): a full-width canvas with the review
 * queue behind a badged toolbar icon that opens it as a sheet, canvas
 * overflow surfacing in the queue's banner (R18), node focus opening the
 * evidence panel, the add-triple gesture opening the shared form (R7), and
 * decision completion refreshing both readers of the schema-graph feed.
 */

import React, { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19 gates act() on this flag; RTL only sets it inside its own
// helpers, and these tests drive captured child props directly.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const {
  graphProps,
  graphRefetchMock,
  railProps,
  sheetProps,
  sheetOpenChange,
  formProps,
  railReexecuteMock,
  queryState,
  queryDocs,
} = vi.hoisted(() => ({
  graphProps: { current: null as any },
  graphRefetchMock: vi.fn(),
  railProps: { current: null as any },
  sheetProps: { current: null as any },
  sheetOpenChange: { current: null as ((open: boolean) => void) | null },
  formProps: { current: null as any },
  railReexecuteMock: vi.fn(),
  queryState: {
    graph: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  queryDocs: {
    SettingsOntologySchemaGraphQuery: Symbol("schemaGraph"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsOntologySchemaGraphQuery) {
      return [queryState.graph, railReexecuteMock];
    }
    throw new Error("unexpected query");
  },
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));

vi.mock("@thinkwork/graph", () => ({
  OntologyGraph: React.forwardRef(function MockOntologyGraph(
    props: any,
    ref: any,
  ) {
    graphProps.current = props;
    React.useImperativeHandle(ref, () => ({ refetch: graphRefetchMock }));
    return <div data-testid="ontology-graph" />;
  }),
}));

vi.mock("./OntologyReviewRail", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    OntologyReviewRail: (props: any) => {
      railProps.current = props;
      return <div data-testid="review-rail" />;
    },
  };
});

vi.mock("./OntologyCandidateSheet", () => ({
  OntologyCandidateSheet: (props: any) => {
    sheetProps.current = props;
    return <div data-testid="candidate-sheet" />;
  },
}));

vi.mock("./OntologyTripleForm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    OntologyTripleForm: (props: any) => {
      formProps.current = props;
      return <div data-testid="triple-form" />;
    },
  };
});

// The Sheet chrome renders as controlled passthroughs so sheet content is
// directly reachable without Radix portal plumbing.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Sheet: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: React.ReactNode;
    }) => {
      sheetOpenChange.current = onOpenChange ?? null;
      return open ? <div>{children}</div> : null;
    },
    SheetContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

import { OntologyMapView } from "./OntologyMapView";

afterEach(cleanup);

const GRAPH = {
  tenantId: "tenant-1",
  types: [
    {
      slug: "site",
      name: "Site",
      instanceCount: 4,
      lifecycleStatus: "APPROVED",
    },
    {
      slug: "crew",
      name: "Crew",
      instanceCount: 2,
      lifecycleStatus: "APPROVED",
    },
  ],
  relationships: [
    {
      slug: "works_at",
      name: "Works at",
      sourceTypeSlugs: ["crew"],
      targetTypeSlugs: ["site"],
    },
  ],
  candidates: [
    {
      itemId: "item-1",
      changeSetId: "set-1",
      itemType: "ENTITY_TYPE",
      slug: "work_order",
      proposedValue: { slug: "work_order", name: "Work Order" },
      editedValue: null,
      evidenceCount: 12,
      origin: "suggestion_engine",
      status: "PENDING_REVIEW",
    },
    {
      itemId: "item-settled",
      changeSetId: "set-1",
      itemType: "ENTITY_TYPE",
      slug: "old_thing",
      proposedValue: { slug: "old_thing", name: "Old Thing" },
      editedValue: null,
      evidenceCount: 1,
      origin: "user",
      status: "DEFERRED",
    },
  ],
};

describe("OntologyMapView", () => {
  beforeEach(() => {
    graphRefetchMock.mockReset();
    railReexecuteMock.mockReset();
    graphProps.current = null;
    railProps.current = null;
    sheetProps.current = null;
    sheetOpenChange.current = null;
    formProps.current = null;
    queryState.graph = {
      data: { ontologySchemaGraph: GRAPH },
      fetching: false,
      error: undefined,
    };
    window.localStorage.clear();
  });

  const openQueue = () =>
    fireEvent.click(screen.getByRole("button", { name: /review queue/i }));

  it("hosts the full-width canvas with no persistent rail column", () => {
    render(<OntologyMapView />);

    expect(screen.getByTestId("ontology-graph")).toBeTruthy();
    expect(graphProps.current.tenantId).toBe("tenant-1");
    // The review queue is behind the toolbar icon — never a reserved column.
    expect(screen.queryByTestId("review-rail")).toBeNull();
  });

  it("shows the pending count as a badge on the queue icon", () => {
    render(<OntologyMapView />);

    const trigger = screen.getByRole("button", { name: /review queue/i });
    expect(trigger.textContent).toContain("1");
  });

  it("hides the badge when nothing is pending", () => {
    queryState.graph = {
      data: { ontologySchemaGraph: { ...GRAPH, candidates: [] } },
      fetching: false,
      error: undefined,
    };
    render(<OntologyMapView />);

    const trigger = screen.getByRole("button", { name: /review queue/i });
    expect(trigger.textContent).not.toContain("0");
  });

  it("opens the review queue sheet from the toolbar icon", () => {
    render(<OntologyMapView />);

    openQueue();

    expect(screen.getByTestId("review-rail")).toBeTruthy();
    // Only still-pending candidates reach the queue.
    expect(railProps.current.candidates).toHaveLength(1);
    expect(railProps.current.candidates[0].itemId).toBe("item-1");
  });

  it("closing the sheet dismisses the queue", () => {
    render(<OntologyMapView />);

    openQueue();
    act(() => sheetOpenChange.current?.(false));

    expect(screen.queryByTestId("review-rail")).toBeNull();
  });

  it("forwards canvas ghost overflow to the queue banner (R18)", () => {
    render(<OntologyMapView />);

    act(() => graphProps.current.onCandidateOverflow(7));
    openQueue();
    expect(railProps.current.overflowCount).toBe(7);
  });

  it("opens the evidence panel when a ghost node is clicked (AE2 entry)", () => {
    render(<OntologyMapView />);

    act(() =>
      graphProps.current.onNodeClick({
        id: "candidate:item-1",
        kind: "candidate",
        itemId: "item-1",
        changeSetId: "set-1",
        label: "Work Order",
        slug: "work_order",
      }),
    );

    expect(screen.getByTestId("candidate-sheet")).toBeTruthy();
    expect(sheetProps.current.focus).toEqual({
      kind: "candidate",
      itemId: "item-1",
      changeSetId: "set-1",
      label: "Work Order",
    });
  });

  it("opens the definition panel when an approved type is clicked (R6 entry)", () => {
    render(<OntologyMapView />);

    act(() =>
      graphProps.current.onNodeClick({
        id: "type:site",
        kind: "type",
        slug: "site",
        label: "Site",
      }),
    );

    expect(sheetProps.current.focus).toEqual({
      kind: "type",
      slug: "site",
      name: "Site",
    });
  });

  it("opens the evidence panel from a queue row, with Back returning to the queue", () => {
    render(<OntologyMapView />);

    openQueue();
    act(() => railProps.current.onSelect(GRAPH.candidates[0]));

    expect(sheetProps.current.focus).toMatchObject({
      kind: "candidate",
      itemId: "item-1",
    });
    // Queue → evidence is a push: the panel gets a back-stack entry and
    // Back lands on the queue sheet again.
    expect(sheetProps.current.historyDepth).toBe(1);
    act(() => sheetProps.current.onBack());
    expect(screen.getByTestId("review-rail")).toBeTruthy();
    expect(screen.queryByTestId("candidate-sheet")).toBeNull();
  });

  it("opens the shared triple form from the add-triple gesture (R7)", () => {
    render(<OntologyMapView />);

    fireEvent.click(screen.getByRole("button", { name: /Add triple/ }));

    expect(screen.getByTestId("triple-form")).toBeTruthy();
    expect(formProps.current.editItem).toBeNull();
    expect(formProps.current.typeOptions).toEqual([
      { slug: "site", name: "Site" },
      { slug: "crew", name: "Crew" },
    ]);
    // R14 precheck universe: approved types + relationships + pending slugs.
    expect([...formProps.current.existingSlugs].sort()).toEqual([
      "crew",
      "site",
      "work_order",
      "works_at",
    ]);
  });

  it("pushes the candidate into the form editor from the panel's Edit", () => {
    render(<OntologyMapView />);

    openQueue();
    act(() => railProps.current.onSelect(GRAPH.candidates[0]));
    act(() =>
      sheetProps.current.onEdit({
        id: "item-1",
        changeSetId: "set-1",
        itemType: "ENTITY_TYPE",
        updatedAt: "2026-07-18T12:00:00.000Z",
        value: { slug: "work_order" },
      }),
    );

    expect(screen.getByTestId("triple-form")).toBeTruthy();
    expect(formProps.current.editItem).toMatchObject({ id: "item-1" });

    // Back returns to the evidence panel (sheet back-stack).
    act(() => formProps.current.onCancel());
    expect(screen.getByTestId("candidate-sheet")).toBeTruthy();
  });

  it("refreshes canvas and queue after a decision, then closes the sheet", () => {
    render(<OntologyMapView />);

    openQueue();
    act(() => railProps.current.onSelect(GRAPH.candidates[0]));
    act(() => sheetProps.current.onActionComplete());

    expect(graphRefetchMock).toHaveBeenCalled();
    expect(railReexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(screen.queryByTestId("candidate-sheet")).toBeNull();
  });

  it("shows the day-one pack callout on a fresh tenant and routes to packs (R12)", () => {
    queryState.graph = {
      data: {
        ontologySchemaGraph: { ...GRAPH, candidates: [] },
      },
      fetching: false,
      error: undefined,
    };
    const onOpenPacks = vi.fn();
    render(<OntologyMapView onOpenPacks={onOpenPacks} />);

    expect(screen.getByText(/install a starter pack/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Browse starter packs" }),
    );
    expect(onOpenPacks).toHaveBeenCalled();
  });

  it("persists callout dismissal per admin across remounts", () => {
    queryState.graph = {
      data: { ontologySchemaGraph: { ...GRAPH, candidates: [] } },
      fetching: false,
      error: undefined,
    };
    const first = render(<OntologyMapView onOpenPacks={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss starter pack suggestion" }),
    );
    expect(screen.queryByText(/install a starter pack/i)).toBeNull();

    // A fresh mount (reload / view switch) stays dismissed for this admin.
    first.unmount();
    render(<OntologyMapView onOpenPacks={vi.fn()} />);
    expect(screen.queryByText(/install a starter pack/i)).toBeNull();
  });

  it("hides the callout once candidates are pending review", () => {
    // GRAPH has <= 4 types but one pending candidate — no nudge.
    render(<OntologyMapView onOpenPacks={vi.fn()} />);
    expect(screen.queryByText(/install a starter pack/i)).toBeNull();
  });

  it("opens the sheet on the handed-off focus after a pack install (AE4)", () => {
    const onInitialFocusConsumed = vi.fn();
    render(
      <OntologyMapView
        initialFocus={{
          kind: "candidate",
          itemId: "item-1",
          changeSetId: "set-1",
          label: "Work Order",
        }}
        onInitialFocusConsumed={onInitialFocusConsumed}
      />,
    );

    expect(screen.getByTestId("candidate-sheet")).toBeTruthy();
    expect(sheetProps.current.focus).toMatchObject({
      kind: "candidate",
      itemId: "item-1",
      changeSetId: "set-1",
    });
    expect(onInitialFocusConsumed).toHaveBeenCalled();
  });

  it("refreshes without closing after a form save conflict refresh (AE1 ghost via refetch)", () => {
    render(<OntologyMapView />);

    fireEvent.click(screen.getByRole("button", { name: /Add triple/ }));
    act(() => formProps.current.onSaved());

    // Save success closes the form and re-fetches — the new triple renders
    // as a ghost from the refreshed feed, with no approve call anywhere.
    expect(graphRefetchMock).toHaveBeenCalled();
    expect(railReexecuteMock).toHaveBeenCalled();
    expect(screen.queryByTestId("triple-form")).toBeNull();
  });
});
