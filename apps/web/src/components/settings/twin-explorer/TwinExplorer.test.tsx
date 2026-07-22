import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnFiltersState } from "@tanstack/react-table";

const cohortCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const urqlState = vi.hoisted(() => ({
  ontology: { fetching: false, data: null as unknown, error: null },
  cohort: { fetching: false, data: null as unknown, error: null },
}));
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
    if (!args.pause) cohortCalls.push(args.variables ?? {});
    return [args.pause ? { fetching: false } : urqlState.cohort, vi.fn()];
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));
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
      onRowClick,
    }: {
      data: Array<{ label: string }>;
      onRowClick?: (row: unknown) => void;
    }) => (
      <div data-testid="data-table">
        {data.map((row, index) => (
          <button
            key={index}
            type="button"
            data-testid="data-row"
            onClick={() => onRowClick?.(row)}
          >
            {row.label}
          </button>
        ))}
      </div>
    ),
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
    lifecycleStatus: "approved",
    sourceTypeSlugs: ["customer"],
    targetTypeSlugs: ["tank"],
  },
  {
    slug: "tank_feeds_line",
    name: "Feeds line",
    lifecycleStatus: "approved",
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
        lifecycleStatus: "approved",
        twinFacets: FACETS_JSON,
      },
      {
        slug: "tank",
        name: "Tank",
        lifecycleStatus: "approved",
        twinFacets: FACETS_JSON,
      },
      {
        slug: "draft_type",
        name: "Draft",
        lifecycleStatus: "proposed",
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
    expect(model.entityType).toBe("customer");
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

  it("offers only governed filter columns: approved types, declared attributes, declared relationships", () => {
    render(<TwinExplorer />);
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
    applyFilters([typeFilter]);
    expect(screen.getByTestId("explorer-loading")).toBeTruthy();
  });

  it("renders the degrade state for a typed unavailable result", () => {
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
    applyFilters([typeFilter]);
    expect(screen.getByTestId("explorer-unavailable").textContent).toContain(
      "twin_not_deployed",
    );
  });

  it("shows the clamp note at the cap", () => {
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(100) },
      error: null,
    };
    render(<TwinExplorer />);
    applyFilters([typeFilter]);
    expect(screen.getByTestId("explorer-limit-note")).toBeTruthy();
  });

  it("row click navigates to the entity detail with type + canonicalId", () => {
    render(<TwinExplorer />);
    applyFilters([typeFilter]);
    fireEvent.click(screen.getAllByTestId("data-row")[0]!);
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
