import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryGraph } from "./MemoryGraph.js";

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

/** Minimal 2D context recorder: captures alpha at fill time and text. */
function paintNode(props: any, node: any) {
  const record = {
    fillAlpha: -1,
    texts: [] as string[],
  };
  let currentAlpha = 1;
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
      record.fillAlpha = currentAlpha;
    },
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fillText(text: string) {
      record.texts.push(text);
    },
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
  props.nodeCanvasObject({ ...node, x: 0, y: 0 }, ctx as any, 1);
  return record;
}

const memoryGraphFixture = {
  nodes: [
    { id: "ent-1", label: "Acme", type: "entity", entityType: "company" },
    { id: "ent-2", label: "Q3 Risk", type: "entity", entityType: "risk" },
    { id: "ent-3", label: "Lone Entity", type: "entity", entityType: "person" },
  ],
  edges: [{ source: "ent-1", target: "ent-2", label: "mentions" }],
};

describe("MemoryGraph (2D canvas)", () => {
  async function renderWithData() {
    urqlMocks.useQuery.mockReturnValue([
      {
        fetching: false,
        data: { memoryGraph: memoryGraphFixture },
        error: null,
      },
      vi.fn(),
    ] as any);
    render(<MemoryGraph useRequesterScope />);
    await screen.findByTestId("force-graph");
    return latestForceGraphProps();
  }

  it("wires the interactivity contract: click, drag, background, pointer area", async () => {
    const props = await renderWithData();

    // Custom-painted nodes need an explicit pointer area or clicks/drags
    // silently die — the regression that sank previous 2D attempts.
    expect(typeof props.nodePointerAreaPaint).toBe("function");
    const pointerCtx = {
      fillStyle: "",
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    props.nodePointerAreaPaint(
      { ...props.graphData.nodes[0], x: 5, y: 6 },
      "#ff0000",
      pointerCtx,
    );
    expect(pointerCtx.fill).toHaveBeenCalled();
    expect(pointerCtx.fillStyle).toBe("#ff0000");

    expect(typeof props.onNodeClick).toBe("function");
    expect(typeof props.onBackgroundClick).toBe("function");
    // Drag end pins the node in the plane.
    const dragged: any = { fx: undefined, fy: undefined, x: 3, y: 4 };
    props.onNodeDragEnd(dragged);
    expect(dragged.fx).toBe(3);
    expect(dragged.fy).toBe(4);
  });

  it("focus dims non-neighborhood nodes; Escape restores the overview", async () => {
    const props = await renderWithData();

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[0]);
    });

    let latest = latestForceGraphProps();
    expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(1);
    expect(paintNode(latest, props.graphData.nodes[1]).fillAlpha).toBe(1);
    expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(0.15);
    // No graphData rebuild on focus (no-restart invariant).
    expect(latest.graphData).toBe(props.graphData);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    latest = latestForceGraphProps();
    expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(1);
  });

  it("focusing an isolated node lights only it, labels only the lit set", async () => {
    const props = await renderWithData();

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[2]);
    });

    const latest = latestForceGraphProps();
    expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(0.15);
    expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(1);
    // Lit node draws its label; dimmed node does not.
    expect(paintNode(latest, props.graphData.nodes[2]).texts.length).toBe(1);
    expect(paintNode(latest, props.graphData.nodes[0]).texts.length).toBe(0);
    expect(screen.queryByText("Showing direct connections only")).toBeNull();
  });

  it("relationship labels draw only on lit edges in focus", async () => {
    const props = await renderWithData();
    const link = {
      ...props.graphData.links[0],
      source: { id: "ent-1", x: 0, y: 0 },
      target: { id: "ent-2", x: 100, y: 0 },
    };
    const texts: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      stroke() {},
      fill() {},
      fillText(t: string) {
        texts.push(t);
      },
      font: "",
      textAlign: "",
      textBaseline: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
    };

    // Overview: no edge labels.
    props.linkCanvasObject(link, ctx as any, 1);
    expect(texts).toEqual([]);

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[0]);
    });
    latestForceGraphProps().linkCanvasObject(link, ctx as any, 1);
    expect(texts).toEqual(["mentions"]);
  });
});
