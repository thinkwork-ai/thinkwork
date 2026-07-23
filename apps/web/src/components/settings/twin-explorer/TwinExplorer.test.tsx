import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnFiltersState } from "@tanstack/react-table";

const cohortCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const summaryCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const memberCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const urqlState = vi.hoisted(() => ({
  ontology: { fetching: false, data: null as unknown, error: null },
  cohort: { fetching: false, data: null as unknown, error: null },
  summary: null as unknown,
  members: null as unknown,
}));
const twinGraphProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const navigateMock = vi.hoisted(() => vi.fn());
// The mocked standard filter applies this state to the REAL table instance
// when clicked — tests drive the component through its actual filter state.
const nextFilters = vi.hoisted(() => ({
  value: [] as ColumnFiltersState,
}));
const filterColumnsSeen = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("urql", () => ({
  useQuery: (args: {
    query?: { definitions?: Array<{ name?: { value?: string } }> };
    variables?: Record<string, unknown>;
    pause?: boolean;
  }) => {
    const name = args.query?.definitions?.[0]?.name?.value;
    if (name === "TwinExplorerOntology") return [urqlState.ontology, vi.fn()];
    return [{ fetching: false }, vi.fn()];
  },
  // Cohort/summary/member queries route through the client by name.
  useClient: () => ({
    query: (
      query: { definitions?: Array<{ name?: { value?: string } }> },
      variables: Record<string, unknown>,
    ) => {
      const name = query?.definitions?.[0]?.name?.value;
      if (name === "TwinCohort") cohortCalls.push(variables ?? {});
      if (name === "TwinNeighborSummary") summaryCalls.push(variables ?? {});
      if (name === "TwinNeighborMembers") memberCalls.push(variables ?? {});
      return {
        toPromise: () =>
          Promise.resolve({
            data:
              name === "TwinNeighborSummary"
                ? { twinNeighborSummary: urqlState.summary }
                : name === "TwinNeighborMembers"
                  ? { twinNeighborMembers: urqlState.members }
                  : {
                      twinCohort: (
                        urqlState.cohort.data as {
                          twinCohort?: unknown;
                        } | null
                      )?.twinCohort,
                    },
            error: undefined,
          }),
      };
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));
vi.mock("@thinkwork/graph", () => {
  const doc = (value: string) => ({ definitions: [{ name: { value } }] });
  return {
    // Captures props so tests can drive traversal click routing; renders
    // controlled mode distinctly from the self-fetching overview.
    TwinGraph: (props: Record<string, unknown>) => {
      twinGraphProps.push(props);
      return (
        <div
          data-testid={
            props.data ? "twin-traversal-graph" : "twin-overview-graph"
          }
        />
      );
    },
    TwinNeighborSummaryQuery: doc("TwinNeighborSummary"),
    TwinNeighborMembersQuery: doc("TwinNeighborMembers"),
    mapNeptuneNode: (raw: unknown, isCenter: boolean) => {
      const node = raw as Record<string, unknown>;
      const id = node?.["~id"];
      if (typeof id !== "string") return null;
      const properties = (node["~properties"] as Record<string, unknown>) ?? {};
      const labels = Array.isArray(node["~labels"]) ? node["~labels"] : [];
      const match = /^t#[^#]+#e#(.+)$/.exec(id);
      return {
        id,
        canonicalId: match ? match[1] : null,
        label: (properties.displayName as string) ?? id,
        typeLabel: (labels[0] as string) ?? null,
        isSystem: false,
        isCenter,
        properties,
      };
    },
  };
});
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@thinkwork/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@thinkwork/ui")>("@thinkwork/ui");
  return {
    ...actual,
    // Stand-in for the standard filter: records the governed columns it was
    // offered and applies `nextFilters` to the real table on click.
    DataTableTokenFilter: ({
      table,
      columns,
    }: {
      table: { setColumnFilters: (state: ColumnFiltersState) => void };
      columns: unknown[];
    }) => {
      filterColumnsSeen.value = columns;
      return (
        <button
          type="button"
          data-testid="token-filter"
          onClick={() => table.setColumnFilters(nextFilters.value)}
        >
          filter
        </button>
      );
    },
    DataTable: ({
      data,
      columns,
      onRowClick,
    }: {
      data: Array<{ label: string }>;
      columns?: Array<{
        id?: string;
        cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
      }>;
      onRowClick?: (row: unknown) => void;
    }) => {
      // Render the traversal select column's real cell so checkbox tests
      // drive the actual toggle wiring.
      const selectColumn = columns?.find((column) => column.id === "select");
      return (
        <div data-testid="data-table">
          {data.map((row, index) => (
            <div key={index} className="flex items-center">
              {selectColumn?.cell?.({ row: { original: row } })}
              <button
                type="button"
                data-testid="data-row"
                onClick={() => onRowClick?.(row)}
              >
                {row.label}
              </button>
            </div>
          ))}
        </div>
      );
    },
  };
});

import {
  ENTITY_TYPE_COLUMN_ID,
  PATH_COLUMN_ID,
  TwinExplorer,
  buildExplorerFilterModel,
  parseTwinCohortFailure,
  parseTwinCohortRows,
} from "./TwinExplorer";
import { parseExplorerFacets } from "./PredicateBuilder";

const FACETS_JSON = JSON.stringify([
  {
    slug: "aging",
    sourceSystem: "lastmile",
    clonePolicy: "deep_clone",
    attributes: [
      { sourceField: "dpd", attribute: "daysPastDue", filterType: "number" },
      { sourceField: "hold", attribute: "creditHold", filterType: "boolean" },
      { sourceField: "memo", attribute: "memo" },
    ],
  },
]);
const FACETS = parseExplorerFacets(FACETS_JSON);

const RELATIONSHIPS = [
  {
    slug: "customer_has_tank",
    name: "Has tank",
    lifecycleStatus: "APPROVED",
    sourceTypeSlugs: ["customer"],
    targetTypeSlugs: ["tank"],
  },
  {
    slug: "tank_feeds_line",
    name: "Feeds line",
    lifecycleStatus: "APPROVED",
    sourceTypeSlugs: ["tank"],
    targetTypeSlugs: ["line"],
  },
];

const ONTOLOGY_DATA = {
  ontologyDefinitions: {
    entityTypes: [
      {
        slug: "customer",
        name: "Customer",
        lifecycleStatus: "APPROVED",
        twinFacets: FACETS_JSON,
      },
      {
        slug: "tank",
        name: "Tank",
        lifecycleStatus: "APPROVED",
        twinFacets: FACETS_JSON,
      },
      {
        slug: "draft_type",
        name: "Draft",
        lifecycleStatus: "PROPOSED",
        twinFacets: FACETS_JSON,
      },
    ],
    relationshipTypes: RELATIONSHIPS,
  },
};

function cohortPayload(count: number) {
  return JSON.stringify({
    ok: true,
    results: Array.from({ length: count }, (_, i) => ({
      node: {
        "~id": `t#tenant-1#e#cust-${i}`,
        "~labels": ["customer"],
        "~properties": {
          displayName: `Customer ${i}`,
          f_aging__daysPastDue: 90 + i,
          f_aging__state: "synced",
        },
      },
    })),
  });
}

const typeFilter = {
  id: ENTITY_TYPE_COLUMN_ID,
  value: { operator: "is", value: ["customer"] },
};

function applyFilters(filters: ColumnFiltersState) {
  nextFilters.value = filters;
  fireEvent.click(screen.getByTestId("token-filter"));
}

function switchToTable() {
  fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
}

function lastCohortFilter(): Record<string, unknown> {
  return JSON.parse(cohortCalls.at(-1)!.filter as string);
}

describe("buildExplorerFilterModel", () => {
  it("AE1: a number token compiles to a typed predicate with a JSON number", () => {
    const model = buildExplorerFilterModel(
      [
        typeFilter,
        {
          id: "attr:aging.daysPastDue",
          value: { operator: "greater_than", value: "90" },
        },
      ],
      FACETS,
      RELATIONSHIPS,
    );
    expect(model.entityTypes).toEqual(["customer"]);
    expect(model.predicates).toEqual([
      { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
    ]);
    expect(model.errors).toEqual([]);
  });

  it("maps the full number-operator vocabulary onto compiler ops", () => {
    const cases: Array<[string, string]> = [
      ["is", "eq"],
      ["is_not", "ne"],
      ["greater_than", "gt"],
      ["greater_or_equal", "gte"],
      ["less_than", "lt"],
      ["less_or_equal", "lte"],
    ];
    for (const [operator, op] of cases) {
      const model = buildExplorerFilterModel(
        [
          typeFilter,
          { id: "attr:aging.daysPastDue", value: { operator, value: "5" } },
        ],
        FACETS,
        RELATIONSHIPS,
      );
      expect(model.predicates[0]).toMatchObject({ op, value: 5 });
    }
  });

  it("boolean and text tokens compile to eq/ne and contains", () => {
    const model = buildExplorerFilterModel(
      [
        typeFilter,
        {
          id: "attr:aging.creditHold",
          value: { operator: "is", value: true },
        },
        {
          id: "attr:aging.memo",
          value: { operator: "contains", value: "late" },
        },
      ],
      FACETS,
      RELATIONSHIPS,
    );
    expect(model.predicates).toEqual([
      { facet: "aging", attribute: "creditHold", op: "eq", value: true },
      { facet: "aging", attribute: "memo", op: "contains", value: "late" },
    ]);
  });

  it("a Related-to token becomes a declared path filter", () => {
    const model = buildExplorerFilterModel(
      [
        typeFilter,
        {
          id: PATH_COLUMN_ID,
          value: { operator: "is", value: ["customer_has_tank"] },
        },
      ],
      FACETS,
      RELATIONSHIPS,
    );
    expect(model.path).toEqual({
      relationship: "customer_has_tank",
      targetType: "tank",
      predicates: [],
    });
  });

  it("non-numeric input on a number attribute surfaces an error, not a bad query", () => {
    const model = buildExplorerFilterModel(
      [
        typeFilter,
        {
          id: "attr:aging.daysPastDue",
          value: { operator: "greater_than", value: "abc" },
        },
      ],
      FACETS,
      RELATIONSHIPS,
    );
    expect(model.predicates).toEqual([]);
    expect(model.errors).toHaveLength(1);
  });

  it("undeclared attributes are ignored", () => {
    const model = buildExplorerFilterModel(
      [
        typeFilter,
        {
          id: "attr:aging.undeclared",
          value: { operator: "contains", value: "x" },
        },
      ],
      FACETS,
      RELATIONSHIPS,
    );
    expect(model.predicates).toEqual([]);
  });
});

describe("TwinExplorer", () => {
  beforeEach(() => {
    cohortCalls.length = 0;
    navigateMock.mockClear();
    nextFilters.value = [];
    filterColumnsSeen.value = [];
    urqlState.ontology = { fetching: false, data: ONTOLOGY_DATA, error: null };
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(3) },
      error: null,
    };
  });
  afterEach(cleanup);

  it("defaults to the graph view over the customer type without any filter", () => {
    render(<TwinExplorer />);
    expect(screen.getByTestId("twin-overview-graph")).toBeTruthy();
    expect(cohortCalls).toHaveLength(0);
    switchToTable();
    expect(cohortCalls.at(-1)!.entityType).toBe("customer");
    expect(lastCohortFilter().predicates).toEqual([]);
  });

  it("offers only governed filter columns: approved types, declared attributes, declared relationships", () => {
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    const ids = (filterColumnsSeen.value as Array<{ id: string }>).map(
      (column) => column.id,
    );
    expect(ids).toContain(ENTITY_TYPE_COLUMN_ID);
    expect(ids).toContain("attr:aging.daysPastDue");
    expect(ids).toContain("attr:aging.creditHold");
    expect(ids).toContain(PATH_COLUMN_ID);
    expect(ids).not.toContain("attr:aging.undeclared");
    const typeColumn = (
      filterColumnsSeen.value as Array<{
        id: string;
        options?: Array<{ value: string }>;
      }>
    ).find((column) => column.id === ENTITY_TYPE_COLUMN_ID)!;
    const optionValues = (typeColumn.options ?? []).map(
      (option) => option.value,
    );
    expect(optionValues).toEqual(["customer", "tank"]); // proposed excluded
  });

  it("AE1: applying type + number token issues the typed cohort filter", () => {
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([
      typeFilter,
      {
        id: "attr:aging.daysPastDue",
        value: { operator: "greater_than", value: "90" },
      },
    ]);
    const last = cohortCalls.at(-1)!;
    expect(last.entityType).toBe("customer");
    expect(last.limit).toBe(100);
    expect(lastCohortFilter().predicates).toEqual([
      { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
    ]);
  });

  it("AE2: committed name search rides the filter as nameContains", () => {
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    fireEvent.click(screen.getByTestId("explorer-search-toggle"));
    const search = screen.getByTestId("explorer-name-search");
    fireEvent.change(search, { target: { value: "FORMOSA" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(lastCohortFilter().nameContains).toBe("FORMOSA");
  });

  it("publishes the console header controller and mounts the console on toggle", () => {
    let controller: { toggleConsole: () => void; consoleOpen: boolean } | null =
      null;
    render(
      <TwinExplorer
        onHeaderControllerChange={(next) => {
          controller = next;
        }}
      />,
    );
    expect(controller).not.toBeNull();
    expect(screen.queryByTestId("cypher-console")).toBeNull();
    React.act(() => controller!.toggleConsole());
    expect(screen.getByTestId("cypher-console")).toBeTruthy();
  });

  it("shows the loading skeleton while the cohort is in flight", () => {
    urqlState.cohort = { fetching: true, data: null, error: null };
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    expect(screen.getByTestId("explorer-loading")).toBeTruthy();
  });

  it("renders the degrade state for a typed unavailable result", async () => {
    urqlState.cohort = {
      fetching: false,
      data: {
        twinCohort: JSON.stringify({
          ok: false,
          reason: "unavailable",
          detail: "twin_not_deployed",
        }),
      },
      error: null,
    };
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    expect(
      (await screen.findByTestId("explorer-unavailable")).textContent,
    ).toContain("twin_not_deployed");
  });

  it("shows the clamp note at the cap", async () => {
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(100) },
      error: null,
    };
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    expect(await screen.findByTestId("explorer-limit-note")).toBeTruthy();
  });

  it("row click navigates to the entity detail with type + canonicalId", async () => {
    render(<TwinExplorer />);
    switchToTable();
    applyFilters([typeFilter]);
    fireEvent.click((await screen.findAllByTestId("data-row"))[0]!);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/memory/explorer/$entityType/$canonicalId",
      params: { entityType: "customer", canonicalId: "cust-0" },
    });
  });
});

describe("cohort payload parsing", () => {
  it("maps rows and parses canonical ids", () => {
    const rows = parseTwinCohortRows(cohortPayload(2))!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      canonicalId: "cust-0",
      label: "Customer 0",
    });
    expect(parseTwinCohortRows(JSON.stringify({ ok: false }))).toBeNull();
  });

  it("extracts typed failures", () => {
    expect(
      parseTwinCohortFailure(
        JSON.stringify({ ok: false, reason: "invalid_request", detail: "bad" }),
      ),
    ).toEqual({ reason: "invalid_request", detail: "bad" });
    expect(parseTwinCohortFailure(cohortPayload(1))).toBeNull();
  });
});

describe("TwinExplorer traversal (twin-traversal plan U4/U5)", () => {
  const SUMMARY_PAYLOAD = JSON.stringify({
    ok: true,
    results: [
      {
        relationship: "customer_has_tank",
        direction: "out",
        targetType: "tank",
        count: 2,
      },
    ],
  });
  const MEMBERS_PAYLOAD = JSON.stringify({
    ok: true,
    results: [
      {
        members: [
          {
            "~id": "t#tenant-1#e#tank-1",
            "~labels": ["tank"],
            "~properties": { displayName: "Tank 1" },
          },
        ],
        edges: [
          {
            rel: "customer_has_tank",
            sourceId: "t#tenant-1#e#cust-0",
            targetId: "t#tenant-1#e#tank-1",
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    cohortCalls.length = 0;
    summaryCalls.length = 0;
    memberCalls.length = 0;
    twinGraphProps.length = 0;
    navigateMock.mockClear();
    nextFilters.value = [];
    filterColumnsSeen.value = [];
    urqlState.ontology = { fetching: false, data: ONTOLOGY_DATA, error: null };
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(2) },
      error: null,
    };
    urqlState.summary = SUMMARY_PAYLOAD;
    urqlState.members = MEMBERS_PAYLOAD;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function lastGraphProps(): Record<string, any> {
    return twinGraphProps.at(-1)!;
  }

  it("AE4/R1: opening the console hides the search/filter toolbar; closing restores it", () => {
    let controller: { toggleConsole: () => void } | null = null;
    render(
      <TwinExplorer
        onHeaderControllerChange={(next) => {
          controller = next as { toggleConsole: () => void };
        }}
      />,
    );
    expect(screen.getByTestId("explorer-search-toggle")).toBeTruthy();
    expect(screen.getByTestId("token-filter")).toBeTruthy();
    React.act(() => controller!.toggleConsole());
    expect(screen.queryByTestId("explorer-search-toggle")).toBeNull();
    expect(screen.queryByTestId("token-filter")).toBeNull();
    React.act(() => controller!.toggleConsole());
    expect(screen.getByTestId("explorer-search-toggle")).toBeTruthy();
    expect(screen.getByTestId("token-filter")).toBeTruthy();
  });

  it("R2: the console renders without the heading and read-only caption", () => {
    let controller: { toggleConsole: () => void } | null = null;
    render(
      <TwinExplorer
        onHeaderControllerChange={(next) => {
          controller = next as { toggleConsole: () => void };
        }}
      />,
    );
    React.act(() => controller!.toggleConsole());
    expect(screen.getByTestId("cypher-console")).toBeTruthy();
    expect(screen.getByTestId("console-input")).toBeTruthy();
    expect(screen.getByTestId("console-run")).toBeTruthy();
    expect(screen.queryByText(/Cypher console/)).toBeNull();
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  it("search picker fetches results from the server and a pick roots traversal", async () => {
    vi.useFakeTimers();
    render(<TwinExplorer />);
    fireEvent.click(screen.getByTestId("explorer-search-toggle"));
    const input = screen.getByTestId("traversal-entity-search");
    fireEvent.change(input, { target: { value: "Customer" } });
    // Debounced server search: nothing until the window elapses.
    expect(cohortCalls).toHaveLength(0);
    await React.act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    // Fans out across ALL approved types (specific customers findable even
    // when no type filter is checked), server-limited per type.
    expect(cohortCalls.map((call) => call.entityType).sort()).toEqual([
      "customer",
      "tank",
    ]);
    expect(cohortCalls.every((call) => call.limit === 10)).toBe(true);
    expect(JSON.parse(cohortCalls[0]!.filter as string).nameContains).toBe(
      "Customer",
    );

    const results = screen.getByTestId("traversal-search-results");
    expect(results).toBeTruthy();
    const first = results.querySelector("button")!;
    await React.act(async () => {
      fireEvent.click(first);
    });
    expect(screen.getByTestId("twin-traversal-graph")).toBeTruthy();
    expect(summaryCalls.at(-1)).toMatchObject({
      tenantId: "tenant-1",
      canonicalId: "cust-0",
    });
  });

  it("KTD-7: an overview node click roots traversal and fetches the ring", async () => {
    render(<TwinExplorer />);
    const overview = lastGraphProps();
    await React.act(async () => {
      overview.onNodeClick?.({
        id: "t#tenant-1#e#cust-0",
        canonicalId: "cust-0",
        label: "Customer 0",
        typeLabel: "customer",
        isSystem: false,
        isCenter: false,
        properties: {},
      });
    });
    expect(screen.getByTestId("twin-traversal-graph")).toBeTruthy();
    expect(summaryCalls.at(-1)).toMatchObject({ canonicalId: "cust-0" });
    const traversal = lastGraphProps();
    const summaryNode = (traversal.data.nodes as Array<any>).find(
      (node) => node.kind === "summary",
    );
    expect(summaryNode.label).toBe("Tank (2)");
  });

  it("R6/R11: summary click fetches the first member batch; R10: clear returns to overview", async () => {
    render(<TwinExplorer />);
    await React.act(async () => {
      lastGraphProps().onNodeClick?.({
        id: "t#tenant-1#e#cust-0",
        canonicalId: "cust-0",
        label: "Customer 0",
        typeLabel: "customer",
        isSystem: false,
        isCenter: false,
        properties: {},
      });
    });
    const summaryNode = (lastGraphProps().data.nodes as Array<any>).find(
      (node) => node.kind === "summary",
    );
    await React.act(async () => {
      lastGraphProps().onNodeClick?.(summaryNode);
    });
    expect(memberCalls.at(-1)).toMatchObject({
      canonicalId: "cust-0",
      relationship: "customer_has_tank",
      targetType: "tank",
      direction: "out",
      offset: 0,
      limit: 20,
    });
    const nodes = lastGraphProps().data.nodes as Array<any>;
    expect(nodes.map((node) => node.id)).toContain("t#tenant-1#e#tank-1");

    fireEvent.click(screen.getByTestId("traversal-clear"));
    expect(screen.getByTestId("twin-overview-graph")).toBeTruthy();
  });

  it("R8: double-clicking an entity navigates to the detail view", async () => {
    render(<TwinExplorer />);
    await React.act(async () => {
      lastGraphProps().onNodeClick?.({
        id: "t#tenant-1#e#cust-0",
        canonicalId: "cust-0",
        label: "Customer 0",
        typeLabel: "customer",
        isSystem: false,
        isCenter: false,
        properties: {},
      });
    });
    await React.act(async () => {
      lastGraphProps().onNodeDoubleClick?.({
        id: "t#tenant-1#e#cust-0",
        canonicalId: "cust-0",
        label: "Customer 0",
        typeLabel: "customer",
        isSystem: false,
        isCenter: true,
        properties: {},
      });
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/memory/explorer/$entityType/$canonicalId",
      params: { entityType: "customer", canonicalId: "cust-0" },
    });
  });

  it("R9: table checkboxes accumulate traversal roots", async () => {
    render(<TwinExplorer />);
    await React.act(async () => {
      switchToTable();
    });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);
    await React.act(async () => {
      fireEvent.click(checkboxes[0]!);
    });
    await React.act(async () => {
      fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    });
    expect(summaryCalls.map((call) => call.canonicalId)).toEqual([
      "cust-0",
      "cust-1",
    ]);
  });
});
