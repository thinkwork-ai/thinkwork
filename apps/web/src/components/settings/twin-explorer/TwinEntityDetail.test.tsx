import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pageResult: {
  data?: unknown;
  fetching?: boolean;
  error?: { message: string };
} = { fetching: true };
let entityResult: { data?: unknown; fetching?: boolean } = { fetching: false };
let edgesResult: { data?: unknown; fetching?: boolean } = { fetching: false };

vi.mock("urql", () => ({
  useQuery: (args: { query?: unknown }) => {
    const name = (
      args.query as {
        definitions?: Array<{ name?: { value?: string } }>;
      }
    )?.definitions?.[0]?.name?.value;
    if (name === "TwinEntityPage") return [pageResult, vi.fn()];
    if (name === "TwinEntity") return [entityResult, vi.fn()];
    return [edgesResult, vi.fn()];
  },
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@thinkwork/graph", () => ({
  TwinGraph: () => <div data-testid="twin-graph" />,
}));

import {
  parseTwinEntityDisplayName,
  parseTwinSystemEdges,
  TwinEntityDetail,
} from "./TwinEntityDetail";

const PROJECTED_PAGE = JSON.stringify({
  projected: true,
  sections: [
    {
      slug: "aging",
      heading: "Aging",
      kind: "facet_backed",
      state: "OK",
      ageSeconds: 120,
      provenance: "source_backed",
      data: { values: { daysPastDue: 94, balance: 1200.5 } },
      detail: null,
    },
    {
      slug: "notes",
      heading: "Notes",
      kind: "knowledge",
      state: "ERROR",
      ageSeconds: null,
      provenance: "knowledge",
      data: null,
      detail: "boom",
    },
  ],
});

const SYSTEM_EDGES = JSON.stringify({
  ok: true,
  results: [
    {
      systems: [
        { systemSlug: "lastmile", externalId: "CUST-042", namespace: "prod" },
      ],
    },
  ],
});

function renderDetail() {
  return render(
    <TwinEntityDetail entityType="customer" canonicalId="cust-42" />,
  );
}

describe("TwinEntityDetail", () => {
  beforeEach(() => {
    pageResult = { fetching: true };
    entityResult = { fetching: false };
    edgesResult = { fetching: false };
  });
  afterEach(cleanup);

  it("shows a loading state until the page resolves", () => {
    renderDetail();
    expect(screen.getByText("Loading entity…")).toBeTruthy();
  });

  it("renders projected sections with state chips for an entity with no wiki page", () => {
    pageResult = {
      fetching: false,
      data: { twinEntityPage: PROJECTED_PAGE },
    };
    entityResult = {
      data: {
        twinEntity: JSON.stringify({
          ok: true,
          results: [
            { node: { "~properties": { displayName: "FORMOSA PLASTICS" } } },
          ],
        }),
      },
    };
    edgesResult = { data: { twinSystemEdges: SYSTEM_EDGES } };
    renderDetail();
    expect(screen.getByText("FORMOSA PLASTICS")).toBeTruthy();
    expect(screen.getByTestId("twin-projected-sections")).toBeTruthy();
    expect(screen.getByText("Aging")).toBeTruthy();
    // OK section renders values; ERROR section renders its own state only.
    expect(screen.getByText("94")).toBeTruthy();
    expect(
      screen.getByText(/couldn't load \(boom\)/, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText("Synced · 2m ago")).toBeTruthy();
    // System edges panel with the external id.
    expect(screen.getByTestId("twin-system-edges")).toBeTruthy();
    expect(screen.getByText("CUST-042")).toBeTruthy();
    expect(screen.getByText("lastmile · prod")).toBeTruthy();
  });

  it("renders the non-projected fallback reason plainly", () => {
    pageResult = {
      fetching: false,
      data: {
        twinEntityPage: JSON.stringify({
          projected: false,
          reason: "no_sections_declared",
        }),
      },
    };
    renderDetail();
    expect(
      screen.getByTestId("twin-detail-not-projected").textContent,
    ).toContain("no_sections_declared");
  });

  it("shows the error state for an invalid entity instead of crashing", () => {
    pageResult = {
      fetching: false,
      error: { message: "boom" },
      data: undefined,
    };
    renderDetail();
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });

  it("renders without crashing when operator-only sections are absent", () => {
    pageResult = {
      fetching: false,
      data: {
        twinEntityPage: JSON.stringify({ projected: true, sections: [] }),
      },
    };
    renderDetail();
    expect(screen.queryByTestId("twin-projected-sections")).toBeNull();
  });
});

describe("payload parsers", () => {
  it("parses displayName from the twinEntity envelope", () => {
    expect(
      parseTwinEntityDisplayName(
        JSON.stringify({
          ok: true,
          results: [{ node: { "~properties": { displayName: "ACME" } } }],
        }),
      ),
    ).toBe("ACME");
    expect(
      parseTwinEntityDisplayName(JSON.stringify({ ok: false })),
    ).toBeNull();
    expect(parseTwinEntityDisplayName("not json {{")).toBeNull();
  });

  it("parses system edge rows and drops malformed entries", () => {
    expect(
      parseTwinSystemEdges(
        JSON.stringify({
          ok: true,
          results: [
            {
              systems: [
                { systemSlug: "p21", externalId: "77" },
                { systemSlug: 42, externalId: "bad" },
                null,
              ],
            },
          ],
        }),
      ),
    ).toEqual([{ systemSlug: "p21", externalId: "77", namespace: null }]);
    expect(parseTwinSystemEdges(undefined)).toEqual([]);
  });
});
