import { describe, expect, it } from "vitest";
import { resolveFacetFreshness } from "./freshness.js";

const facets = [
  {
    slug: "aging",
    clonePolicy: "deep_clone",
    cadence: null,
    sourceSystem: "lastmile",
    sourceDataset: null,
    attributes: [],
    note: null,
  },
  {
    slug: "order_lines",
    clonePolicy: "limited",
    cadence: null,
    sourceSystem: "lastmile",
    sourceDataset: null,
    attributes: [],
    note: null,
  },
  {
    slug: "level",
    clonePolicy: "deep_clone",
    cadence: null,
    sourceSystem: "xfluid",
    sourceDataset: null,
    attributes: [],
    note: null,
  },
] as never;

describe("resolveFacetFreshness — R15 trichotomy (AE7)", () => {
  it("distinguishes limited / pending / synced / synced_empty", () => {
    const states = resolveFacetFreshness({
      facets,
      nodeProperties: {
        // aging: synced with values
        f_aging__synced_at: "2026-07-21T10:00:00.000Z",
        f_aging__batch: "b1",
        f_aging__seq: 9,
        f_aging__state: "synced",
        f_aging__daysPastDue: 31,
        // level: synced but source held nothing → definitive empty
        f_level__synced_at: "2026-07-21T10:00:00.000Z",
        f_level__batch: "b1",
        f_level__seq: 9,
        f_level__state: "synced",
      },
      now: new Date("2026-07-21T11:00:00.000Z"),
    });

    const byFacet = Object.fromEntries(states.map((s) => [s.facet, s]));
    expect(byFacet.aging.state).toBe("synced");
    expect(byFacet.aging.ageSeconds).toBe(3600);
    expect(byFacet.aging.values).toEqual({ daysPastDue: 31 });
    expect(byFacet.order_lines.state).toBe("limited");
    expect(byFacet.level.state).toBe("synced_empty");
  });

  it("no stamps at all → pending (mid-bootstrap: follow the edge, name the state)", () => {
    const states = resolveFacetFreshness({ facets, nodeProperties: {} });
    const byFacet = Object.fromEntries(states.map((s) => [s.facet, s]));
    expect(byFacet.aging.state).toBe("pending");
    expect(byFacet.order_lines.state).toBe("limited");
  });

  it("tombstoned wins over synced", () => {
    const states = resolveFacetFreshness({
      facets,
      nodeProperties: {
        f_aging__synced_at: "2026-07-21T10:00:00.000Z",
        f_aging__state: "tombstoned",
        f_aging__daysPastDue: 5,
      },
    });
    expect(states.find((s) => s.facet === "aging")!.state).toBe("tombstoned");
  });

  it("tolerates raw jsonb declarations (parse path)", () => {
    const states = resolveFacetFreshness({
      facets: [
        { slug: "aging", clonePolicy: "deep_clone", sourceSystem: "lastmile" },
        { bogus: true },
      ],
      nodeProperties: {},
    });
    expect(states).toHaveLength(1);
    expect(states[0].state).toBe("pending");
  });
});
