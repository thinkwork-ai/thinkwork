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
        zoom: () => 1,
        screen2GraphCoords: (x: number, y: number) => ({ x, y }),
        graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
        d3ReheatSimulation: vi.fn(),
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

/** Position nodes 1000px apart so geometric hit-testing is unambiguous
 *  (the identity screen<->graph mocks make screen == graph coords). */
function placeNodes(props: any) {
  props.graphData.nodes.forEach((node: any, i: number) => {
    node.x = i * 1000;
    node.y = 0;
  });
}

function pointerEvent(type: string, x: number, y: number) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
}

async function clickNodeIndex(index: number) {
  placeNodes(latestForceGraphProps());
  const container = screen.getByTestId("graph-container");
  await act(async () => {
    container.dispatchEvent(pointerEvent("click", index * 1000, 0));
  });
}

async function clickBackground() {
  const container = screen.getByTestId("graph-container");
  await act(async () => {
    container.dispatchEvent(pointerEvent("click", 5_000_000, 5000));
  });
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
    measureText(text: string) {
      return { width: text.length * 6 };
    },
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

  it("wires the interactivity contract: geometric click, drag, background", async () => {
    const props = await renderWithData();

    // The library's canvas color-picking is disabled (Brave's
    // fingerprinting shield poisons canvas readback); interaction is
    // geometric via the pointer hook.
    expect(props.enablePointerInteraction).toBe(false);

    // Drag: pointerdown on a node, move, release — node pins in place.
    placeNodes(latestForceGraphProps());
    const container = screen.getByTestId("graph-container");
    const node = props.graphData.nodes[0];
    await act(async () => {
      container.dispatchEvent(pointerEvent("pointerdown", 0, 0));
      window.dispatchEvent(pointerEvent("pointermove", 40, 25));
      window.dispatchEvent(pointerEvent("pointerup", 40, 25));
    });
    expect(node.fx).toBe(40);
    expect(node.fy).toBe(25);
  });

  it("focus dims non-neighborhood nodes; Escape restores the overview", async () => {
    const props = await renderWithData();

    await clickNodeIndex(0);

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

    await clickNodeIndex(2);

    const latest = latestForceGraphProps();
    expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(0.15);
    expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(1);
    // Lit node draws its label; dimmed node does not.
    expect(
      paintNode(latest, props.graphData.nodes[2]).texts.length,
    ).toBeGreaterThan(0);
    expect(paintNode(latest, props.graphData.nodes[0]).texts.length).toBe(0);
    expect(screen.queryByText("Showing direct connections only")).toBeNull();
  });

  it("relationship labels draw only on lit edges in focus", async () => {
    const props = await renderWithData();
    const link = {
      ...props.graphData.links[0],
      source: { id: "ent-1", x: 0, y: 0 },
      target: { id: "ent-2", x: 200, y: 0 },
    };
    const texts: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      arc() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      stroke() {},
      fill() {},
      measureText(t: string) {
        return { width: t.length * 6 };
      },
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

    // Small graph: the gate is always open, so the overview shows the
    // label inline in the line (neo4j style).
    props.linkCanvasObject(link, ctx as any, 1);
    expect(texts).toEqual(["mentions"]);

    // Focus an unrelated node: this link is no longer lit — plain line.
    texts.length = 0;
    await clickNodeIndex(2);
    latestForceGraphProps().linkCanvasObject(link, ctx as any, 1);
    expect(texts).toEqual([]);
  });
});
