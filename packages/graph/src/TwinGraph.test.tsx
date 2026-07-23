import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TwinGraph,
  buildTwinGraphData,
  mergeTwinGraphData,
  twinCanonicalIdFromNodeId,
  type TwinGraphData,
} from "./TwinGraph.js";

const forceGraphCalls = vi.hoisted(() => [] as any[]);
const zoomToFit = vi.hoisted(() => vi.fn());
const urqlState = vi.hoisted(() => ({
  result: { fetching: false, data: null as any, error: null as any },
  reexecute: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: vi.fn(() => [urqlState.result, urqlState.reexecute]),
  useClient: vi.fn(() => ({
    query: vi.fn(() => ({
      toPromise: () => new Promise(() => {}),
    })),
  })),
}));

vi.mock("react-force-graph-2d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef((props: any, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({
        zoomToFit,
        zoom: () => 1,
        // Screen coords == graph coords for these tests (zoom k = 1); the
        // geometric pointer resolves clicks through this.
        screen2GraphCoords: (x: number, y: number) => ({ x, y }),
        graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
        d3Force: () => undefined,
        d3ReheatSimulation: () => undefined,
      }));
      // The sim doesn't run under the mock — pin deterministic positions
      // so geometric hit-testing has coordinates (node i at x = i * 100).
      props.graphData.nodes.forEach((node: any, index: number) => {
        node.x = index * 100;
        node.y = 0;
      });
      forceGraphCalls.push(props);
      return ReactActual.createElement("canvas", {
        "data-testid": "force-graph",
      });
    }),
  };
});

/** Geometric click: pointerdown/up on the canvas then the click event. */
function clickCanvas(canvas: Element, x: number, y: number) {
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  canvas.dispatchEvent(new MouseEvent("pointerdown", { ...opts, button: 0 }));
  window.dispatchEvent(new MouseEvent("pointerup", { ...opts, button: 0 }));
  canvas.dispatchEvent(new MouseEvent("click", { ...opts, button: 0 }));
}

const NODE = (id: string, displayName: string, label = "customer") => ({
  "~id": id,
  "~labels": [label],
  "~properties": { displayName },
});

const PAYLOAD = JSON.stringify({
  ok: true,
  results: [
    {
      node: NODE("t#ten-1#e#cust-1", "ACME"),
      neighbors: [
        NODE("t#ten-1#e#tank-9", "Tank 9", "tank"),
        NODE("t#ten-1#e#cust-1", "ACME"),
      ],
      edges: [
        {
          rel: "customer_has_tank",
          sourceId: "t#ten-1#e#cust-1",
          targetId: "t#ten-1#e#tank-9",
        },
        {
          rel: "customer_has_tank",
          sourceId: "t#ten-1#e#cust-1",
          targetId: "t#ten-1#e#tank-9",
        },
        {
          rel: "dangling",
          sourceId: "t#ten-1#e#cust-1",
          targetId: "t#x#e#gone",
        },
      ],
    },
  ],
});

// jsdom has no ResizeObserver; the component only needs one measure call.
beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  forceGraphCalls.length = 0;
  zoomToFit.mockClear();
  urqlState.result = { fetching: false, data: null, error: null };
});
afterEach(cleanup);

describe("buildTwinGraphData", () => {
  it("maps the payload onto node/edge shapes, deduped", () => {
    const data = buildTwinGraphData(PAYLOAD);
    expect(data.nodes.map((n) => n.id)).toEqual([
      "t#ten-1#e#cust-1",
      "t#ten-1#e#tank-9",
    ]);
    expect(data.nodes[0]).toMatchObject({
      canonicalId: "cust-1",
      label: "ACME",
      typeLabel: "customer",
      isCenter: true,
    });
    // Duplicate edge deduped; edge to an off-canvas node dropped.
    expect(data.links).toHaveLength(1);
    expect(data.links[0]).toMatchObject({ label: "customer_has_tank" });
  });

  it("returns empty data for unavailable/garbage payloads", () => {
    expect(buildTwinGraphData(JSON.stringify({ ok: false }))).toEqual({
      nodes: [],
      links: [],
    });
    expect(buildTwinGraphData("{{nope")).toEqual({ nodes: [], links: [] });
  });

  it("parses canonical ids only from same-shape ~ids", () => {
    expect(twinCanonicalIdFromNodeId("t#ten-1#e#cust-1")).toBe("cust-1");
    expect(twinCanonicalIdFromNodeId("system#lastmile")).toBeNull();
  });
});

describe("buildTwinGraphData — subgraph paths", () => {
  it("extracts labeled, property-carrying edges from path arrays", () => {
    const payload = JSON.stringify({
      ok: true,
      results: [
        {
          roots: [NODE("t#ten-1#e#cust-1", "ACME")],
          neighbors: [NODE("t#ten-1#e#tank-9", "Tank 9", "tank")],
          paths: [
            [
              NODE("t#ten-1#e#cust-1", "ACME"),
              {
                "~id": "t#ten-1#r#x1",
                "~entityType": "relationship",
                "~type": "customer_has_tank",
                "~start": "t#ten-1#e#cust-1",
                "~end": "t#ten-1#e#tank-9",
                "~properties": { since: "2024" },
              },
              NODE("t#ten-1#e#tank-9", "Tank 9", "tank"),
            ],
          ],
        },
      ],
    });
    const data = buildTwinGraphData(payload);
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0]!.isCenter).toBe(true);
    expect(data.links).toEqual([
      expect.objectContaining({
        label: "customer_has_tank",
        properties: { since: "2024" },
      }),
    ]);
  });

  it("renders isolated roots (OPTIONAL MATCH) without edges", () => {
    const payload = JSON.stringify({
      ok: true,
      results: [
        {
          roots: [
            NODE("t#ten-1#e#cust-1", "ACME"),
            NODE("t#ten-1#e#cust-2", "MORT"),
          ],
          neighbors: [],
          paths: [],
        },
      ],
    });
    const data = buildTwinGraphData(payload);
    expect(data.nodes).toHaveLength(2);
    expect(data.links).toEqual([]);
  });
});

describe("mergeTwinGraphData", () => {
  it("keeps surviving node object identity across merges", () => {
    const target: TwinGraphData = { nodes: [], links: [] };
    mergeTwinGraphData(target, PAYLOAD);
    const survivor = target.nodes[1]!;
    (survivor as any).x = 42; // sim-hydrated position
    mergeTwinGraphData(target, PAYLOAD);
    expect(target.nodes[1]).toBe(survivor);
    expect((target.nodes[1] as any).x).toBe(42);
  });
});

describe("TwinGraph", () => {
  it("renders the empty state for a lone node, not a crash", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinNeighbors: JSON.stringify({
          ok: true,
          results: [
            {
              node: NODE("t#ten-1#e#cust-1", "ACME"),
              neighbors: [],
              edges: [],
            },
          ],
        }),
      },
    };
    render(<TwinGraph tenantId="ten-1" canonicalId="cust-1" />);
    expect(screen.getByTestId("twin-graph-empty")).toBeTruthy();
  });

  it("fires onNodeClick via geometric picking, canonical id parsed", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: { twinNeighbors: PAYLOAD },
    };
    const onNodeClick = vi.fn();
    render(
      <TwinGraph
        tenantId="ten-1"
        canonicalId="cust-1"
        onNodeClick={onNodeClick}
      />,
    );
    clickCanvas(screen.getByTestId("force-graph"), 100, 0);
    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalId: "tank-9" }),
    );
  });

  it("R4: a node WITHOUT a canonical id (system node) still reports clicks", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinNeighbors: JSON.stringify({
          ok: true,
          results: [
            {
              node: NODE("t#ten-1#e#cust-1", "ACME"),
              neighbors: [
                {
                  "~id": "t#ten-1#sys#lastmile",
                  "~labels": [],
                  "~properties": {},
                },
              ],
              edges: [
                {
                  rel: "external_identity",
                  sourceId: "t#ten-1#e#cust-1",
                  targetId: "t#ten-1#sys#lastmile",
                },
              ],
            },
          ],
        }),
      },
    };
    const onNodeClick = vi.fn();
    render(
      <TwinGraph
        tenantId="ten-1"
        canonicalId="cust-1"
        onNodeClick={onNodeClick}
      />,
    );
    clickCanvas(screen.getByTestId("force-graph"), 100, 0);
    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t#ten-1#sys#lastmile", isSystem: true }),
    );
  });

  it("routes double-clicks and edge clicks through the geometric pointer", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: { twinNeighbors: PAYLOAD },
    };
    const onNodeDoubleClick = vi.fn();
    const onLinkClick = vi.fn();
    render(
      <TwinGraph
        tenantId="ten-1"
        canonicalId="cust-1"
        onNodeDoubleClick={onNodeDoubleClick}
        onLinkClick={onLinkClick}
      />,
    );
    const canvas = screen.getByTestId("force-graph");
    clickCanvas(canvas, 100, 0);
    clickCanvas(canvas, 100, 0);
    expect(onNodeDoubleClick).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalId: "tank-9" }),
    );
    // Midpoint of the cust-1 (x=0) → tank-9 (x=100) link, off both discs.
    const link = forceGraphCalls.at(-1).graphData.links[0];
    link.source = forceGraphCalls.at(-1).graphData.nodes[0];
    link.target = forceGraphCalls.at(-1).graphData.nodes[1];
    clickCanvas(canvas, 50, 0);
    expect(onLinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ label: "customer_has_tank" }),
    );
  });

  it("one-shot framing: depth-change data merges never re-frame the camera", () => {
    urqlState.result = {
      fetching: false,
      error: null,
      data: { twinNeighbors: PAYLOAD },
    };
    const view = render(<TwinGraph tenantId="ten-1" canonicalId="cust-1" />);
    const first = forceGraphCalls.at(-1);
    // Framing fires once, early in the settle (tick >= 15) — and never
    // again afterwards (no end-of-settle zoom snap).
    for (let i = 0; i < 40; i += 1) first.onEngineTick();
    expect(zoomToFit).toHaveBeenCalledTimes(1);

    // New payload (depth change) — engine settles again, no re-frame.
    urqlState.result = {
      fetching: false,
      error: null,
      data: {
        twinNeighbors: PAYLOAD.replace("Tank 9", "Tank Nine"),
      },
    };
    view.rerender(
      <TwinGraph tenantId="ten-1" canonicalId="cust-1" depth={2} />,
    );
    const third = forceGraphCalls.at(-1);
    for (let i = 0; i < 40; i += 1) third.onEngineTick();
    expect(zoomToFit).toHaveBeenCalledTimes(1);
  });
});
