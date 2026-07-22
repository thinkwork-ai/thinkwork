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
}));

vi.mock("react-force-graph-2d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef((props: any, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({
        zoomToFit,
        zoom: () => 1,
      }));
      forceGraphCalls.push(props);
      return ReactActual.createElement("button", {
        "data-testid": "force-graph",
        onClick: () => props.onNodeClick?.(props.graphData.nodes[1]),
      });
    }),
  };
});

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

  it("fires onNodeClick with the parsed canonical id", () => {
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
    fireEvent.click(screen.getByTestId("force-graph"));
    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalId: "tank-9" }),
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
    first.onEngineStop();
    first.onEngineStop();
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
    forceGraphCalls.at(-1).onEngineStop();
    expect(zoomToFit).toHaveBeenCalledTimes(1);
  });
});
