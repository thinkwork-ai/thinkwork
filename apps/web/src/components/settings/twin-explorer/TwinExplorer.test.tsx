import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cohortCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const urqlState = vi.hoisted(() => ({
  ontology: { fetching: false, data: null as unknown, error: null },
  cohort: { fetching: false, data: null as unknown, error: null },
}));
const navigateMock = vi.hoisted(() => vi.fn());

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

vi.mock("@thinkwork/ui", () => {
  const SelectCtx = React.createContext<(value: string) => void>(() => {});
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
    Badge: ({ children }: { children?: React.ReactNode }) => (
      <span>{children}</span>
    ),
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    Select: ({
      onValueChange,
      children,
    }: {
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
    }) => (
      <SelectCtx.Provider value={onValueChange ?? (() => {})}>
        {children}
      </SelectCtx.Provider>
    ),
    SelectTrigger: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    SelectContent: passthrough,
    SelectValue: () => <span />,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: React.ReactNode;
    }) => {
      const onValueChange = React.useContext(SelectCtx);
      return (
        <button
          type="button"
          data-select-item={value}
          onClick={() => onValueChange(value)}
        >
          {children}
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
  TwinExplorer,
  parseTwinCohortFailure,
  parseTwinCohortRows,
} from "./TwinExplorer";
import { buildTypedPredicate, parseExplorerFacets } from "./PredicateBuilder";

const FACETS_JSON = JSON.stringify([
  {
    slug: "aging",
    sourceSystem: "lastmile",
    clonePolicy: "deep_clone",
    attributes: [
      { sourceField: "dpd", attribute: "daysPastDue", filterType: "number" },
      { sourceField: "hold", attribute: "creditHold", filterType: "boolean" },
    ],
  },
]);

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
        twinFacets: JSON.stringify([
          {
            slug: "level",
            sourceSystem: "xfluid",
            clonePolicy: "deep_clone",
            attributes: [
              {
                sourceField: "pct",
                attribute: "levelPct",
                filterType: "number",
              },
            ],
          },
        ]),
      },
      {
        slug: "draft_type",
        name: "Draft",
        lifecycleStatus: "proposed",
        twinFacets: FACETS_JSON,
      },
    ],
    relationshipTypes: [
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
    ],
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

function lastCohortFilter(): Record<string, unknown> {
  const last = cohortCalls.at(-1)!;
  return JSON.parse(last.filter as string);
}

function selectEntityType(slug: string) {
  fireEvent.click(
    screen
      .getAllByRole("button")
      .find((el) => el.getAttribute("data-select-item") === slug)!,
  );
}

describe("TwinExplorer", () => {
  beforeEach(() => {
    cohortCalls.length = 0;
    navigateMock.mockClear();
    urqlState.ontology = {
      fetching: false,
      data: ONTOLOGY_DATA,
      error: null,
    };
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(3) },
      error: null,
    };
  });
  afterEach(cleanup);

  it("offers only approved declared entity types", () => {
    render(<TwinExplorer />);
    const items = screen
      .getAllByRole("button")
      .map((el) => el.getAttribute("data-select-item"))
      .filter(Boolean);
    expect(items).toContain("customer");
    expect(items).toContain("tank");
    expect(items).not.toContain("draft_type");
  });

  it("AE1: number predicate goes out as a JSON number, ANDed rows re-issue, remove re-issues without", () => {
    render(<TwinExplorer />);
    selectEntityType("customer");
    // Add predicate: aging.daysPastDue > 90
    fireEvent.click(screen.getByTestId("predicate-add"));
    fireEvent.click(screen.getByRole("button", { name: "aging" }));
    fireEvent.click(screen.getByRole("button", { name: "daysPastDue" }));
    fireEvent.click(screen.getByRole("button", { name: ">" }));
    fireEvent.change(screen.getByTestId("predicate-value"), {
      target: { value: "90" },
    });
    let filter = lastCohortFilter();
    expect(filter.predicates).toEqual([
      { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
    ]);

    // Second row ANDs in.
    fireEvent.click(screen.getByTestId("predicate-add"));
    const row2 = screen.getAllByTestId("predicate-row")[1]!;
    fireEvent.click(
      [...row2.querySelectorAll("button")].find(
        (el) => el.getAttribute("data-select-item") === "aging",
      )!,
    );
    fireEvent.click(
      [...row2.querySelectorAll("button")].find(
        (el) => el.getAttribute("data-select-item") === "creditHold",
      )!,
    );
    fireEvent.click(
      [...row2.querySelectorAll("button")].find(
        (el) => el.getAttribute("data-select-item") === "true",
      )!,
    );
    filter = lastCohortFilter();
    expect(filter.predicates).toEqual([
      { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
      { facet: "aging", attribute: "creditHold", op: "eq", value: true },
    ]);

    // Removing the second row re-issues without it.
    fireEvent.click(screen.getAllByTestId("predicate-remove")[1]!);
    filter = lastCohortFilter();
    expect(filter.predicates).toHaveLength(1);
  });

  it("AE2: name search issues nameContains on Enter", () => {
    render(<TwinExplorer />);
    selectEntityType("customer");
    const search = screen.getByTestId("explorer-name-search");
    fireEvent.change(search, { target: { value: "FORMOSA" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(lastCohortFilter().nameContains).toBe("FORMOSA");
  });

  it("path filter offers only declared relationships for the chosen type", () => {
    render(<TwinExplorer />);
    selectEntityType("customer");
    const pathSection = screen.getByTestId("explorer-path-filter");
    const items = [...pathSection.querySelectorAll("button")]
      .map((el) => el.getAttribute("data-select-item"))
      .filter(Boolean);
    expect(items).toContain("customer_has_tank");
    expect(items).not.toContain("tank_feeds_line");
  });

  it("sends limit 100 and shows the clamp note at the cap", () => {
    urqlState.cohort = {
      fetching: false,
      data: { twinCohort: cohortPayload(100) },
      error: null,
    };
    render(<TwinExplorer />);
    selectEntityType("customer");
    expect(cohortCalls.at(-1)!.limit).toBe(100);
    expect(screen.getByTestId("explorer-limit-note")).toBeTruthy();
  });

  it("shows the loading skeleton while the cohort is in flight", () => {
    urqlState.cohort = { fetching: true, data: null, error: null };
    render(<TwinExplorer />);
    selectEntityType("customer");
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
    selectEntityType("customer");
    expect(screen.getByTestId("explorer-unavailable").textContent).toContain(
      "twin_not_deployed",
    );
  });

  it("row click navigates to the entity detail with type + canonicalId", () => {
    render(<TwinExplorer />);
    selectEntityType("customer");
    fireEvent.click(screen.getAllByTestId("data-row")[0]!);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/memory/explorer/$entityType/$canonicalId",
      params: { entityType: "customer", canonicalId: "cust-0" },
    });
  });
});

describe("predicate helpers", () => {
  it("parses only declared facets/attributes and defaults filterType to string", () => {
    const facets = parseExplorerFacets(
      JSON.stringify([
        {
          slug: "aging",
          attributes: [
            { attribute: "daysPastDue", filterType: "number" },
            { attribute: "memo" },
            { notAttribute: "x" },
          ],
        },
        { slug: "", attributes: [{ attribute: "x" }] },
        { slug: "emptyFacet", attributes: [] },
      ]),
    );
    expect(facets).toEqual([
      {
        slug: "aging",
        attributes: [
          { attribute: "daysPastDue", filterType: "number" },
          { attribute: "memo", filterType: "string" },
        ],
      },
    ]);
    expect(parseExplorerFacets("{{nope")).toEqual([]);
  });

  it("coerces values by declared filterType and rejects mismatches", () => {
    const facets = parseExplorerFacets(FACETS_JSON);
    expect(
      buildTypedPredicate(
        { facet: "aging", attribute: "daysPastDue", op: "gt", value: "90" },
        facets,
      ),
    ).toEqual({
      ok: true,
      predicate: {
        facet: "aging",
        attribute: "daysPastDue",
        op: "gt",
        value: 90,
      },
    });
    expect(
      buildTypedPredicate(
        { facet: "aging", attribute: "daysPastDue", op: "gt", value: "abc" },
        facets,
      ),
    ).toMatchObject({ ok: false });
    expect(
      buildTypedPredicate(
        { facet: "aging", attribute: "creditHold", op: "eq", value: "true" },
        facets,
      ),
    ).toEqual({
      ok: true,
      predicate: {
        facet: "aging",
        attribute: "creditHold",
        op: "eq",
        value: true,
      },
    });
    expect(
      buildTypedPredicate(
        { facet: "aging", attribute: "daysPastDue", op: "exists", value: "" },
        facets,
      ),
    ).toEqual({
      ok: true,
      predicate: { facet: "aging", attribute: "daysPastDue", op: "exists" },
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
