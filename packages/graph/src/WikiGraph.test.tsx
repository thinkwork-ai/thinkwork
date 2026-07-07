import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiGraph } from "./WikiGraph.js";
import { WikiGraphQuery } from "./queries.js";

const forceGraphCalls = vi.hoisted(() => [] as any[]);
const urqlMocks = vi.hoisted(() => ({
  useQuery: vi.fn(() => [
    { fetching: true, data: null as any, error: null },
    vi.fn(),
  ]),
  query: vi.fn(() => ({ toPromise: vi.fn() })),
}));

vi.mock("urql", () => ({
  useClient: () => ({ query: urqlMocks.query }),
  useQuery: urqlMocks.useQuery,
}));

vi.mock("react-force-graph-2d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef((props: any, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({
        d3Force: () => ({
          strength: () => ({ distanceMax: vi.fn() }),
          distance: vi.fn(),
        }),
        zoomToFit: vi.fn(),
        zoom: vi.fn(),
      }));
      forceGraphCalls.push(props);
      return ReactActual.createElement("div", {
        "data-testid": "force-graph",
      });
    }),
  };
});

beforeEach(() => {
  forceGraphCalls.length = 0;

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 960,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 540,
  });

  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function latestForceGraphProps() {
  return forceGraphCalls[forceGraphCalls.length - 1];
}

function paintNodeAlpha(props: any, node: any) {
  let currentAlpha = 1;
  let fillAlpha = -1;
  const ctx = {
    set globalAlpha(v: number) {
      currentAlpha = v;
    },
    get globalAlpha() {
      return currentAlpha;
    },
    beginPath() {},
    arc() {},
    fill() {
      fillAlpha = currentAlpha;
    },
    stroke() {},
    fillText() {},
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
  props.nodeCanvasObject({ ...node, x: 0, y: 0 }, ctx as any, 1);
  return fillAlpha;
}

const wikiGraphFixture = {
  nodes: [
    { id: "page-1", label: "Paris Office", entityType: "ENTITY", slug: "p1" },
    { id: "page-2", label: "Q3 Planning", entityType: "TOPIC", slug: "p2" },
    { id: "page-3", label: "Lone Page", entityType: "TOPIC", slug: "p3" },
  ],
  edges: [{ source: "page-1", target: "page-2", label: "references" }],
};

describe("WikiGraph", () => {
  it("revalidates the graph query so an empty cached graph cannot stick", () => {
    render(
      <WikiGraph tenantId="tenant-1" useRequesterScope searchQuery="Paris" />,
    );

    expect(urqlMocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: WikiGraphQuery,
        variables: { tenantId: "tenant-1", userId: null },
        requestPolicy: "cache-and-network",
        pause: false,
      }),
    );
  });

  it("focus lights the clicked node's neighborhood and background click restores", async () => {
    urqlMocks.useQuery.mockReturnValue([
      {
        fetching: false,
        data: { wikiGraph: wikiGraphFixture },
        error: null,
      },
      vi.fn(),
    ] as any);

    render(<WikiGraph tenantId="tenant-1" useRequesterScope />);
    await screen.findByTestId("force-graph");
    const props = latestForceGraphProps();

    // Interactivity contract: custom-painted nodes must provide a pointer
    // area or clicks/drags silently die.
    expect(typeof props.nodePointerAreaPaint).toBe("function");

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[0]);
    });

    let latest = latestForceGraphProps();
    expect(paintNodeAlpha(latest, props.graphData.nodes[0])).toBe(1);
    expect(paintNodeAlpha(latest, props.graphData.nodes[1])).toBe(1);
    expect(paintNodeAlpha(latest, props.graphData.nodes[2])).toBe(0.15);
    // graphData identity untouched by focus (no-restart invariant).
    expect(latest.graphData).toBe(props.graphData);

    await act(async () => {
      latestForceGraphProps().onBackgroundClick();
    });
    latest = latestForceGraphProps();
    expect(paintNodeAlpha(latest, props.graphData.nodes[2])).toBe(1);
  });
});
