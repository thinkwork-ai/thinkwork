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

vi.mock("react-force-graph-3d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef((props: any, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({
        camera: () => ({
          position: { set: vi.fn() },
          up: { set: vi.fn() },
          lookAt: vi.fn(),
        }),
        controls: () => ({}),
        d3Force: () => ({
          strength: () => ({ distanceMax: vi.fn() }),
          distance: vi.fn(),
        }),
        refresh: vi.fn(),
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

const memoryGraphFixture = {
  nodes: [
    { id: "ent-1", label: "Acme", type: "entity", entityType: "company" },
    { id: "ent-2", label: "Q3 Risk", type: "entity", entityType: "risk" },
    { id: "ent-3", label: "Lone Entity", type: "entity", entityType: "person" },
  ],
  edges: [{ source: "ent-1", target: "ent-2", label: "mentions" }],
};

function seedMaterials(nodes: any[]) {
  for (const node of nodes) {
    node.__sphereMat = { opacity: -1 };
    node.__spriteMat = { opacity: -1 };
  }
}

function opacityById(nodes: any[]) {
  return Object.fromEntries(
    nodes.map((node: any) => [node.id, node.__sphereMat.opacity]),
  );
}

describe("MemoryGraph focus mode", () => {
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
    const props = latestForceGraphProps();
    seedMaterials(props.graphData.nodes);
    return props;
  }

  it("focus lights the neighborhood, Escape restores the overview", async () => {
    const props = await renderWithData();

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[0]);
    });

    let opacities = opacityById(latestForceGraphProps().graphData.nodes);
    expect(opacities["ent-1"]).toBe(1);
    expect(opacities["ent-2"]).toBe(1);
    expect(opacities["ent-3"]).toBe(0.15);
    expect(latestForceGraphProps().graphData).toBe(props.graphData);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    opacities = opacityById(latestForceGraphProps().graphData.nodes);
    expect(opacities["ent-3"]).toBe(1);
  });

  it("focusing an isolated node lights only it, no truncation chip", async () => {
    const props = await renderWithData();

    await act(async () => {
      props.onNodeClick(props.graphData.nodes[2]);
    });

    const opacities = opacityById(latestForceGraphProps().graphData.nodes);
    expect(opacities).toEqual({ "ent-1": 0.15, "ent-2": 0.15, "ent-3": 1 });
    expect(screen.queryByText("Showing direct connections only")).toBeNull();
  });
});
