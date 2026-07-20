/**
 * Living Map host tests (THINK-320 U6): a full-width canvas whose actions
 * (add-triple + badged review-queue icon) publish to the PAGE HEADER via
 * the OntologyMapHeaderController (SettingsMemoryHome renders them, the
 * SettingsMemory refresh-controller pattern), canvas overflow surfacing in
 * the queue's banner (R18), the chip's "View details" opening the evidence
 * panel (node clicks only focus-dim + chip inside OntologyGraph), the
 * add-triple gesture opening the shared form (R7), and decision completion
 * refreshing both readers of the schema-graph feed.
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
  tokenFilterProps,
} = vi.hoisted(() => ({
  tokenFilterProps: { current: null as any },
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
    // Captured so tests can drive the headless filter table directly
    // without Radix popover plumbing.
    DataTableTokenFilter: (props: any) => {
      tokenFilterProps.current = props;
      return <div data-testid="token-filter" />;
    },
  };
});

import {
  OntologyMapView,
  type OntologyMapHeaderController,
} from "./OntologyMapView";

afterEach(cleanup);

/** Captured header controller — the page header's view of the map. */
const headerController = {
  current: null as OntologyMapHeaderController | null,
};
const captureController = (controller: OntologyMapHeaderController | null) => {
  headerController.current = controller;
};

function renderMap(props: React.ComponentProps<typeof OntologyMapView> = {}) {
  return render(
    <OntologyMapView onHeaderControllerChange={captureController} {...props} />,
  );
}

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
    tokenFilterProps.current = null;
    queryState.graph = {
      data: { ontologySchemaGraph: GRAPH },
      fetching: false,
      error: undefined,
    };
    window.localStorage.clear();
    headerController.current = null;
  });

  const openQueue = () => act(() => headerController.current?.openQueue());

  it("hosts the full-width canvas with no local toolbar or rail column", () => {
    renderMap();

    expect(screen.getByTestId("ontology-graph")).toBeTruthy();
    expect(graphProps.current.tenantId).toBe("tenant-1");
    // The review queue is behind the header icon — never a reserved column,
    // and the actions render in the page header, not a map-local toolbar.
    expect(screen.queryByTestId("review-rail")).toBeNull();
    expect(screen.queryByRole("button", { name: /review queue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add triple/i })).toBeNull();
  });

  it("renders the toolbar search and drives the graph's live dim query", () => {
    renderMap();

    expect(graphProps.current.searchQuery).toBeUndefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Search the ontology map" }),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search the ontology map" }),
      { target: { value: "crew" } },
    );

    expect(graphProps.current.searchQuery).toBe("crew");
    // Clearing collapses back to the icon and drops the dim query.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(graphProps.current.searchQuery).toBeUndefined();
  });

  it("publishes the facet set with origin options from the live data", () => {
    renderMap();

    const columns = tokenFilterProps.current.columns;
    expect(columns.map((c: any) => c.id)).toEqual([
      "status",
      "origin",
      "evidence",
      "activity",
    ]);
    expect(
      columns
        .find((c: any) => c.id === "status")
        .options.map((o: any) => o.value),
    ).toEqual(["approved", "proposed"]);

    // Origin options arrive from the graph's onOriginsLoaded callback,
    // labeled for humans.
    act(() =>
      graphProps.current.onOriginsLoaded(["suggestion_engine", "user"]),
    );
    expect(
      tokenFilterProps.current.columns.find((c: any) => c.id === "origin")
        .options,
    ).toEqual([
      { value: "suggestion_engine", label: "Suggestion engine" },
      { value: "user", label: "User" },
    ]);
  });

  it("forwards facet selections to the graph as dim filters", () => {
    renderMap();

    expect(graphProps.current.statusFilter).toBeUndefined();
    act(() =>
      tokenFilterProps.current.table
        .getColumn("status")
        ?.setFilterValue({ operator: "is", value: ["proposed"] }),
    );
    expect(graphProps.current.statusFilter).toEqual(["proposed"]);

    act(() =>
      tokenFilterProps.current.table
        .getColumn("evidence")
        ?.setFilterValue({ operator: "is", value: ["has_evidence"] }),
    );
    expect(graphProps.current.evidenceFilter).toEqual(["has_evidence"]);
    expect(graphProps.current.originFilter).toBeUndefined();
    expect(graphProps.current.activityFilter).toBeUndefined();

    // Clearing a facet drops the filter prop entirely.
    act(() =>
      tokenFilterProps.current.table.getColumn("status")?.setFilterValue(null),
    );
    expect(graphProps.current.statusFilter).toBeUndefined();
  });

  it("publishes the pending count to the header controller", () => {
    renderMap();

    expect(headerController.current?.pendingCount).toBe(1);
  });

  it("publishes a zero pending count when nothing is pending", () => {
    queryState.graph = {
      data: { ontologySchemaGraph: { ...GRAPH, candidates: [] } },
      fetching: false,
      error: undefined,
    };
    renderMap();

    expect(headerController.current?.pendingCount).toBe(0);
  });

  it("clears the header controller on unmount", () => {
    const view = renderMap();

    expect(headerController.current).not.toBeNull();
    view.unmount();
    expect(headerController.current).toBeNull();
  });

  it("opens the review queue sheet from the header queue action", () => {
    renderMap();

    openQueue();

    expect(screen.getByTestId("review-rail")).toBeTruthy();
    // Only still-pending candidates reach the queue.
    expect(railProps.current.candidates).toHaveLength(1);
    expect(railProps.current.candidates[0].itemId).toBe("item-1");
  });

  it("closing the sheet dismisses the queue", () => {
    renderMap();

    openQueue();
    act(() => sheetOpenChange.current?.(false));

    expect(screen.queryByTestId("review-rail")).toBeNull();
  });

  it("forwards canvas ghost overflow to the queue banner (R18)", () => {
    renderMap();

    act(() => graphProps.current.onCandidateOverflow(7));
    openQueue();
    expect(railProps.current.overflowCount).toBe(7);
  });

  it("opens the evidence panel from a ghost chip's View details (AE2 entry)", () => {
    renderMap();

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

  it("opens the definition panel from an approved type chip's View details (R6 entry)", () => {
    renderMap();

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
    renderMap();

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

  it("opens the shared triple form from the header add-triple action (R7)", () => {
    renderMap();

    act(() => headerController.current?.openAddTriple());

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
    renderMap();

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
    renderMap();

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
    renderMap();

    act(() => headerController.current?.openAddTriple());
    act(() => formProps.current.onSaved());

    // Save success closes the form and re-fetches — the new triple renders
    // as a ghost from the refreshed feed, with no approve call anywhere.
    expect(graphRefetchMock).toHaveBeenCalled();
    expect(railReexecuteMock).toHaveBeenCalled();
    expect(screen.queryByTestId("triple-form")).toBeNull();
  });
});
