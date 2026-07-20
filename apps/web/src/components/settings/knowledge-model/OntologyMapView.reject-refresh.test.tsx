/**
 * Integration test for the decision → refresh seam with the REAL
 * OntologyCandidateSheet mounted inside OntologyMapView (the unit tests
 * mock the sheet, so nothing else exercises the actual Reject/Approve
 * buttons driving the host's refreshAll). Live Map bug follow-up: after
 * an item-level reject the rail must re-fetch (network-only) and the
 * canvas must refetch, exactly like approve — a stale rail listing a
 * just-rejected candidate ("1 pending") is the regression this pins.
 */

import React, { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const {
  graphProps,
  graphRefetchMock,
  railReexecuteMock,
  approveMock,
  rejectItemMock,
  queryState,
  queryDocs,
} = vi.hoisted(() => ({
  graphProps: { current: null as any },
  graphRefetchMock: vi.fn(),
  railReexecuteMock: vi.fn(),
  approveMock: vi.fn(),
  rejectItemMock: vi.fn(),
  queryState: {
    schemaGraph: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
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
  queryDocs: {
    SettingsOntologySchemaGraphQuery: Symbol("schemaGraph"),
    SettingsOntologyChangeSetsQuery: Symbol("changeSets"),
    SettingsKnowledgeGraphOntologyQuery: Symbol("definitions"),
    SettingsApproveOntologyChangeSetMutation: Symbol("approve"),
    SettingsRejectOntologyChangeSetItemMutation: Symbol("rejectItem"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsOntologySchemaGraphQuery) {
      return [queryState.schemaGraph, railReexecuteMock];
    }
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

// The triple form pulls its own mutations — out of scope for this seam.
vi.mock("./OntologyTripleForm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    OntologyTripleForm: () => <div data-testid="triple-form" />,
  };
});

// Sheet chrome renders as plain wrappers so the real panel content is
// reachable without Radix portal plumbing.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    Sheet: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) => (open ? <div data-testid="sheet">{children}</div> : null),
    SheetContent: pass,
    SheetHeader: pass,
    SheetTitle: pass,
    SheetDescription: pass,
  };
});

import {
  OntologyMapView,
  type OntologyMapHeaderController,
} from "./OntologyMapView";

afterEach(cleanup);

const headerController = {
  current: null as OntologyMapHeaderController | null,
};

const ITEM = {
  id: "item-1",
  changeSetId: "set-1",
  itemType: "ENTITY_TYPE",
  action: "CREATE",
  status: "PENDING_REVIEW",
  targetSlug: "work_order",
  title: "Add work order",
  description: null,
  proposedValue: { slug: "work_order", name: "Work Order" },
  editedValue: null,
  confidence: 0.9,
  updatedAt: "2026-07-18T12:00:00.000Z",
  evidenceExamples: [],
};

const SCHEMA_GRAPH = {
  tenantId: "tenant-1",
  types: [
    {
      slug: "site",
      name: "Site",
      instanceCount: 4,
      lifecycleStatus: "APPROVED",
    },
  ],
  relationships: [],
  candidates: [
    {
      itemId: "item-1",
      changeSetId: "set-1",
      itemType: "ENTITY_TYPE",
      slug: "work_order",
      proposedValue: { slug: "work_order", name: "Work Order" },
      editedValue: null,
      evidenceCount: 0,
      origin: "user",
      status: "PENDING_REVIEW",
    },
  ],
};

const CHANGE_SETS = [
  {
    id: "set-1",
    title: "Proposed changes",
    summary: null,
    status: "PENDING_REVIEW",
    proposedBy: "user",
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    items: [ITEM],
  },
];

function openCandidateSheet() {
  render(
    <OntologyMapView
      onHeaderControllerChange={(controller) => {
        headerController.current = controller;
      }}
    />,
  );
  // The queue lives behind the badged inbox icon in the PAGE HEADER (the
  // map publishes the gesture via its header controller): open the sheet,
  // then drill into the candidate row.
  act(() => headerController.current?.openQueue());
  expect(screen.getByTestId("sheet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Work Order/ }));
}

describe("OntologyMapView decision refresh (real sheet)", () => {
  beforeEach(() => {
    graphRefetchMock.mockReset();
    railReexecuteMock.mockReset();
    approveMock.mockReset();
    rejectItemMock.mockReset();
    headerController.current = null;
    queryState.schemaGraph = {
      data: { ontologySchemaGraph: SCHEMA_GRAPH },
      fetching: false,
      error: undefined,
    };
    queryState.changeSets = {
      data: { ontologyChangeSets: CHANGE_SETS },
      fetching: false,
      error: undefined,
    };
    queryState.definitions = {
      data: undefined,
      fetching: false,
      error: undefined,
    };
    window.localStorage.clear();
  });

  it("reject fires the same refreshAll path as approve: graph refetch + network-only rail reexecute, then closes", async () => {
    rejectItemMock.mockResolvedValue({ data: {}, error: undefined });
    openCandidateSheet();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });

    await waitFor(() => {
      expect(rejectItemMock).toHaveBeenCalledWith({
        input: { tenantId: "tenant-1", itemId: "item-1" },
      });
    });
    expect(graphRefetchMock).toHaveBeenCalled();
    expect(railReexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("approve drives the identical refresh path (parity check)", async () => {
    approveMock.mockResolvedValue({ data: {}, error: undefined });
    openCandidateSheet();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    await waitFor(() => expect(approveMock).toHaveBeenCalled());
    expect(graphRefetchMock).toHaveBeenCalled();
    expect(railReexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("a failed reject keeps the sheet open and does NOT refresh", async () => {
    rejectItemMock.mockResolvedValue({
      data: undefined,
      error: { message: "boom" },
    });
    openCandidateSheet();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });

    await waitFor(() => expect(rejectItemMock).toHaveBeenCalled());
    expect(graphRefetchMock).not.toHaveBeenCalled();
    expect(railReexecuteMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("sheet")).toBeTruthy();
  });
});
