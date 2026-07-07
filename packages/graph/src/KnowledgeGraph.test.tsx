import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeGraph,
  buildKnowledgeGraphData,
  knowledgeGraphTrustColor,
  knowledgeGraphTrustState,
  type KnowledgeGraphHandle,
} from "./KnowledgeGraph.js";

const forceGraphCalls = vi.hoisted(() => [] as any[]);
const d3ForceCalls = vi.hoisted(() => [] as { name: string; force?: any }[]);
const cameraMock = vi.hoisted(() => ({
  position: {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  },
  up: { set: () => {} },
  lookAt: () => {},
}));
const controlsMock = vi.hoisted(() => ({
  listeners: [] as (() => void)[],
  addEventListener(_event: string, cb: () => void) {
    this.listeners.push(cb);
  },
  removeEventListener(_event: string, cb: () => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  },
}));
const urqlState = vi.hoisted(() => ({
  result: { fetching: false, data: null as any, error: null as any },
  reexecute: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: vi.fn(() => [urqlState.result, urqlState.reexecute]),
}));

vi.mock("react-force-graph-3d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef((props: any, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({
        camera: () => cameraMock,
        controls: () => controlsMock,
        d3Force: (name: string, force?: any) => {
          d3ForceCalls.push({ name, force });
          return {
            strength: () => ({ distanceMax: vi.fn() }),
            distance: vi.fn(),
          };
        },
        refresh: vi.fn(),
      }));
      forceGraphCalls.push(props);
      return ReactActual.createElement("div", {
        "data-testid": "force-graph",
      });
    }),
  };
});

const graphFixture = {
  nodes: [
    {
      id: "entity-1",
      entityId: "entity-1",
      label: "Acme",
      typeLabel: "Company",
      ontologyTypeSlug: "company",
      groundingStatus: "GROUNDED",
      provenanceStatus: "STRONG",
      relationshipCount: 1,
      evidenceCount: 3,
    },
    {
      id: "entity-2",
      entityId: "entity-2",
      label: "Roadmap Risk",
      typeLabel: "Risk",
      ontologyTypeSlug: "risk",
      groundingStatus: "UNGROUNDED",
      provenanceStatus: "STRONG",
      relationshipCount: 2,
      evidenceCount: 1,
    },
    {
      id: "entity-3",
      entityId: "entity-3",
      label: "Beta Contract",
      typeLabel: "Deal",
      ontologyTypeSlug: "deal",
      groundingStatus: "GROUNDED",
      provenanceStatus: "WEAK",
      relationshipCount: 1,
      evidenceCount: 0,
    },
  ],
  edges: [
    {
      id: "edge-1",
      relationshipId: "rel-1",
      source: "entity-1",
      target: "entity-2",
      label: "mentions",
      ontologyTypeSlug: "mentions",
      groundingStatus: "GROUNDED",
      provenanceStatus: "STRONG",
      evidenceCount: 2,
    },
    {
      id: "edge-2",
      relationshipId: "rel-2",
      source: "entity-2",
      target: "entity-3",
      label: "depends on",
      ontologyTypeSlug: "depends_on",
      groundingStatus: "GROUNDED",
      provenanceStatus: "WEAK",
      evidenceCount: 0,
    },
  ],
};

beforeEach(() => {
  forceGraphCalls.length = 0;
  d3ForceCalls.length = 0;
  cameraMock.position.x = 0;
  cameraMock.position.y = 0;
  cameraMock.position.z = 0;
  controlsMock.listeners = [];
  urqlState.result = { fetching: false, data: null, error: null };
  urqlState.reexecute.mockClear();

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
  vi.unstubAllGlobals();
});

function latestForceGraphProps() {
  return forceGraphCalls[forceGraphCalls.length - 1];
}

describe("KnowledgeGraph", () => {
  it("maps knowledgeGraphGraph nodes and edges into ForceGraph data", async () => {
    urqlState.result = {
      fetching: false,
      data: { knowledgeGraphGraph: graphFixture },
      error: null,
    };

    render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);

    await screen.findByTestId("force-graph");
    const props = latestForceGraphProps();

    expect(props.graphData.nodes).toHaveLength(3);
    expect(props.graphData.links).toHaveLength(2);
    expect(props.graphData.nodes[0]).toMatchObject({
      id: "entity-1",
      label: "Acme",
      nodeType: "entity",
      groundingStatus: "GROUNDED",
      provenanceStatus: "STRONG",
    });
  });

  it("keeps trust, diagnostic, and weak-provenance states visually distinct", () => {
    const graphData = buildKnowledgeGraphData(graphFixture);

    expect(knowledgeGraphTrustState(graphData.nodes[0]!)).toBe("trusted");
    expect(knowledgeGraphTrustState(graphData.nodes[1]!)).toBe("diagnostic");
    expect(knowledgeGraphTrustState(graphData.nodes[2]!)).toBe("weak");
    expect(
      new Set(graphData.nodes.map((node) => knowledgeGraphTrustColor(node)))
        .size,
    ).toBe(3);
  });

  it("does not rebuild graph data or reset ForceGraph callbacks for local filters", async () => {
    const data = { knowledgeGraphGraph: graphFixture };
    urqlState.result = { fetching: false, data, error: null };

    const { rerender } = render(
      <KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />,
    );

    await screen.findByTestId("force-graph");
    const firstProps = latestForceGraphProps();
    const firstGraphData = firstProps.graphData;
    const firstNodeThreeObject = firstProps.nodeThreeObject;

    rerender(
      <KnowledgeGraph
        tenantId="tenant-1"
        threadId="thread-1"
        searchQuery="Acme"
      />,
    );

    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();

    expect(nextProps.graphData).toBe(firstGraphData);
    expect(nextProps.nodeThreeObject).toBe(firstNodeThreeObject);
    expect(nextProps.linkColor(nextProps.graphData.links[0])).toContain(
      "#14b8a6",
    );
    expect(nextProps.linkColor(nextProps.graphData.links[1])).toBe(
      "rgba(255,255,255,0.12)",
    );
  });

  it("registers community cluster forces at data cadence, not filter cadence", async () => {
    urqlState.result = {
      fetching: false,
      data: { knowledgeGraphGraph: graphFixture },
      error: null,
    };

    const { rerender } = render(
      <KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />,
    );
    await screen.findByTestId("force-graph");

    const clusterForceCalls = () =>
      d3ForceCalls.filter((call) => call.name === "x" || call.name === "y")
        .length;
    const centerRemovals = d3ForceCalls.filter(
      (call) => call.name === "center" && call.force === null,
    );
    const initialClusterCalls = clusterForceCalls();
    expect(initialClusterCalls).toBeGreaterThanOrEqual(2);
    expect(centerRemovals.length).toBeGreaterThanOrEqual(1);

    rerender(
      <KnowledgeGraph
        tenantId="tenant-1"
        threadId="thread-1"
        searchQuery="Acme"
      />,
    );
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));

    // Filter changes must not re-register forces (no-restart invariant).
    expect(clusterForceCalls()).toBe(initialClusterCalls);
  });

  it("returns connected edges for entity detail sheets", async () => {
    urqlState.result = {
      fetching: false,
      data: { knowledgeGraphGraph: graphFixture },
      error: null,
    };
    const graphRef = React.createRef<KnowledgeGraphHandle>();
    const onNodeClick = vi.fn();

    render(
      <KnowledgeGraph
        ref={graphRef}
        tenantId="tenant-1"
        threadId="thread-1"
        onNodeClick={onNodeClick}
      />,
    );

    await screen.findByTestId("force-graph");
    const props = latestForceGraphProps();

    // Node click surfaces the selected-node chip without opening the
    // sheet; the chip click is what fires the host callback.
    await act(async () => {
      props.onNodeClick(props.graphData.nodes[1]);
    });
    expect(onNodeClick).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Open details for Roadmap Risk" }),
    );

    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entity-2", label: "Roadmap Risk" }),
      expect.arrayContaining([
        expect.objectContaining({
          relationshipId: "rel-1",
          targetId: "entity-1",
          label: "mentions",
        }),
        expect.objectContaining({
          relationshipId: "rel-2",
          targetId: "entity-3",
          label: "depends on",
        }),
      ]),
    );

    expect(graphRef.current?.getNodeWithEdges("entity-2")?.edges).toHaveLength(
      2,
    );
  });

  describe("Graph Focus Mode", () => {
    function seedMaterials(nodes: any[]) {
      for (const node of nodes) {
        node.__sphereMat = { opacity: -1 };
        node.__spriteMat = { opacity: -1 };
        node.__ringMat = { opacity: -1 };
      }
    }

    function opacityById(nodes: any[]) {
      return Object.fromEntries(
        nodes.map((node) => [node.id, node.__sphereMat.opacity]),
      );
    }

    async function renderFocusable(extraProps: Record<string, any> = {}) {
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: graphFixture },
        error: null,
      };
      const view = render(
        <KnowledgeGraph
          tenantId="tenant-1"
          threadId="thread-1"
          {...extraProps}
        />,
      );
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();
      seedMaterials(props.graphData.nodes);
      return { view, props };
    }

    it("clicking a node lights its 2-degree neighborhood and dims the rest (fixture chain lights fully)", async () => {
      const { props } = await renderFocusable();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });

      // entity-1 -> entity-2 -> entity-3 is a chain: 2 degrees from
      // entity-1 covers all three nodes.
      expect(opacityById(latestForceGraphProps().graphData.nodes)).toEqual({
        "entity-1": 1,
        "entity-2": 1,
        "entity-3": 1,
      });
      expect(screen.queryByText("Showing direct connections only")).toBeNull();
    });

    it("background click clears focus and restores prior opacities (AE4)", async () => {
      const { props } = await renderFocusable();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      await act(async () => {
        latestForceGraphProps().onBackgroundClick();
      });

      // No filter active — everything returns to full opacity.
      expect(opacityById(latestForceGraphProps().graphData.nodes)).toEqual({
        "entity-1": 1,
        "entity-2": 1,
        "entity-3": 1,
      });
    });

    it("focus supersedes search dimming and exit restores it (AE5)", async () => {
      const { view, props } = await renderFocusable();

      // Activate search after materials are seeded so the mutation effect
      // writes into them. entity-3 "Beta Contract" matches; the rest dim.
      view.rerender(
        <KnowledgeGraph
          tenantId="tenant-1"
          threadId="thread-1"
          searchQuery="Beta"
        />,
      );
      await waitFor(() =>
        expect(
          opacityById(latestForceGraphProps().graphData.nodes)["entity-1"],
        ).toBe(0.15),
      );

      // Focus entity-1: 2-degree neighborhood lights everything.
      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      expect(
        opacityById(latestForceGraphProps().graphData.nodes)["entity-1"],
      ).toBe(1);

      // Escape exits focus; search classification returns exactly.
      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      const restored = opacityById(latestForceGraphProps().graphData.nodes);
      expect(restored["entity-1"]).toBe(0.15);
      expect(restored["entity-3"]).toBe(1);
    });

    it("clicking a dimmed node moves focus to it (AE6)", async () => {
      const isolatedFixture = {
        nodes: graphFixture.nodes,
        edges: [graphFixture.edges[0]], // entity-3 isolated
      };
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: isolatedFixture },
        error: null,
      };
      render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();
      seedMaterials(props.graphData.nodes);

      // Focus entity-1: lights entity-1 and entity-2; entity-3 dims.
      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      expect(
        opacityById(latestForceGraphProps().graphData.nodes)["entity-3"],
      ).toBe(0.15);

      // Click the dimmed entity-3 — focus traverses to it.
      await act(async () => {
        latestForceGraphProps().onNodeClick(props.graphData.nodes[2]);
      });
      const opacities = opacityById(latestForceGraphProps().graphData.nodes);
      expect(opacities["entity-3"]).toBe(1);
      expect(opacities["entity-1"]).toBe(0.15);
    });

    it("focusing an isolated node lights only it with no truncation chip (AE8)", async () => {
      const isolatedFixture = {
        nodes: graphFixture.nodes,
        edges: [graphFixture.edges[0]], // entity-3 has no edges
      };
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: isolatedFixture },
        error: null,
      };
      render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();
      seedMaterials(props.graphData.nodes);

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[2]);
      });

      const opacities = opacityById(latestForceGraphProps().graphData.nodes);
      expect(opacities).toEqual({
        "entity-1": 0.15,
        "entity-2": 0.15,
        "entity-3": 1,
      });
      expect(screen.queryByText("Showing direct connections only")).toBeNull();
    });

    it("hub over the cap degrades to 1 degree and shows the truncation chip (AE1)", async () => {
      const hubFixture = {
        nodes: [
          { id: "hub", entityId: "hub", label: "Hub" },
          ...Array.from({ length: 151 }, (_, i) => ({
            id: `leaf-${i}`,
            entityId: `leaf-${i}`,
            label: `Leaf ${i}`,
          })),
        ],
        edges: Array.from({ length: 151 }, (_, i) => ({
          id: `edge-${i}`,
          relationshipId: `rel-${i}`,
          source: "hub",
          target: `leaf-${i}`,
          label: "links",
        })),
      };
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: hubFixture },
        error: null,
      };
      render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });

      expect(
        await screen.findByText("Showing direct connections only"),
      ).toBeTruthy();
    });

    it("Escape without focus is a no-op and focus survives clearing search", async () => {
      const { view, props } = await renderFocusable({ searchQuery: "Acme" });

      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      // Clear the search — focus stays active.
      view.rerender(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await waitFor(() =>
        expect(
          opacityById(latestForceGraphProps().graphData.nodes)["entity-1"],
        ).toBe(1),
      );
    });

    it("focus changes rebuild nothing: same graphData, no force re-registration, sheet callback fires", async () => {
      const onNodeClick = vi.fn();
      const { props } = await renderFocusable({ onNodeClick });
      const initialGraphData = props.graphData;
      const initialForceCalls = d3ForceCalls.length;

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[1]);
      });

      const nextProps = latestForceGraphProps();
      expect(nextProps.graphData).toBe(initialGraphData);
      expect(d3ForceCalls.length).toBe(initialForceCalls);

      // Sheet opens from the selected-node chip, not the node click.
      expect(onNodeClick).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /Open details for/ }));
      expect(onNodeClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "entity-2" }),
        expect.any(Array),
      );
    });
  });

  describe("labels", () => {
    // 160 nodes (> gate ceiling): "lone-*" isolated, plus a-b linked.
    const largeFixture = {
      nodes: [
        { id: "a", entityId: "a", label: "Node A" },
        { id: "b", entityId: "b", label: "Node B" },
        ...Array.from({ length: 158 }, (_, i) => ({
          id: `lone-${i}`,
          entityId: `lone-${i}`,
          label: `Lone ${i}`,
        })),
      ],
      edges: [
        {
          id: "e1",
          relationshipId: "r1",
          source: "a",
          target: "b",
          label: "supports",
        },
      ],
    };

    async function renderLarge() {
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: largeFixture },
        error: null,
      };
      render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();
      for (const node of props.graphData.nodes) {
        node.__labelSprite = { visible: false };
        node.__sphereMat = { opacity: -1 };
        node.__spriteMat = { opacity: -1 };
        node.__ringMat = { opacity: -1 };
      }
      return props;
    }

    it("zoom gate shows labels close up and hides them far out (AE2)", async () => {
      const props = await renderLarge();

      // Camera init framed the graph at initialZ (~1265) — gate closed.
      expect(cameraMock.position.z).toBeGreaterThan(800);

      // Zoom in past the threshold.
      cameraMock.position.z = 400;
      controlsMock.listeners.forEach((cb) => cb());
      await waitFor(() =>
        expect(
          props.graphData.nodes.every((n: any) => n.__labelSprite.visible),
        ).toBe(true),
      );

      // Zoom back out — labels hide again.
      cameraMock.position.z = 5000;
      controlsMock.listeners.forEach((cb) => cb());
      await waitFor(() =>
        expect(
          props.graphData.nodes.some((n: any) => n.__labelSprite.visible),
        ).toBe(false),
      );
    });

    it("focus lights lit-node labels at any zoom and only lit-edge label sprites exist (R9/R10)", async () => {
      const props = await renderLarge();

      // Far zoom, gate closed — no edge label sprites either.
      expect(props.linkThreeObjectExtend).toBe(true);
      expect(props.linkThreeObject(props.graphData.links[0])).toBeFalsy();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]); // focus "a"
      });

      const byId = Object.fromEntries(
        props.graphData.nodes.map((n: any) => [n.id, n.__labelSprite.visible]),
      );
      expect(byId["a"]).toBe(true);
      expect(byId["b"]).toBe(true);
      expect(byId["lone-0"]).toBe(false);

      // Lit edge now yields a label sprite; exiting focus removes it.
      const litSprite = latestForceGraphProps().linkThreeObject(
        props.graphData.links[0],
      );
      expect(litSprite).toBeTruthy();
      expect(litSprite.visible).toBe(true);

      await act(async () => {
        latestForceGraphProps().onBackgroundClick();
      });
      expect(
        latestForceGraphProps().linkThreeObject(props.graphData.links[0]),
      ).toBeFalsy();
    });

    it("positions edge-label sprites above the midpoint, rotated along the line", async () => {
      const props = await renderLarge();
      const set = vi.fn();
      const material = { rotation: -1 };
      const keepDefault = props.linkPositionUpdate(
        { position: { set }, material },
        { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
        props.graphData.links[0],
      );
      // Horizontal link: label sits 8 units above the midpoint, unrotated.
      expect(set).toHaveBeenCalledWith(5, 8, 0);
      expect(material.rotation).toBe(0);
      expect(keepDefault).toBe(false);
    });

    it("node-label toggle On overrides the closed zoom gate (AE7)", async () => {
      const props = await renderLarge();

      // Gate closed at framing distance; toggle cycles auto -> on.
      fireEvent.click(screen.getByRole("button", { name: "Show node labels" }));
      await waitFor(() =>
        expect(
          props.graphData.nodes.every((n: any) => n.__labelSprite.visible),
        ).toBe(true),
      );

      // Second click: on -> off hides everything, even zoomed in.
      cameraMock.position.z = 400;
      fireEvent.click(screen.getByRole("button", { name: "Show node labels" }));
      await waitFor(() =>
        expect(
          props.graphData.nodes.some((n: any) => n.__labelSprite.visible),
        ).toBe(false),
      );

      // Third click: back to auto — zoomed-in gate applies again.
      controlsMock.listeners.forEach((cb) => cb());
      fireEvent.click(screen.getByRole("button", { name: "Show node labels" }));
      await waitFor(() =>
        expect(
          props.graphData.nodes.every((n: any) => n.__labelSprite.visible),
        ).toBe(true),
      );
    });

    it("relationship toggle Off removes edge labels while node labels remain (AE3)", async () => {
      const props = await renderLarge();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]); // focus "a"
      });
      expect(
        latestForceGraphProps().linkThreeObject(props.graphData.links[0]),
      ).toBeTruthy();

      // Cycle relationship labels auto -> on -> off.
      const relToggle = () =>
        screen.getByRole("button", { name: "Show relationship labels" });
      fireEvent.click(relToggle());
      fireEvent.click(relToggle());

      await waitFor(() =>
        expect(
          latestForceGraphProps().linkThreeObject(props.graphData.links[0]),
        ).toBeFalsy(),
      );
      // Lit node labels stay visible.
      const byId = Object.fromEntries(
        props.graphData.nodes.map((n: any) => [n.id, n.__labelSprite.visible]),
      );
      expect(byId["a"]).toBe(true);
      expect(byId["b"]).toBe(true);
    });
  });

  it("renders loading, empty, and error states for the Settings surface", async () => {
    urqlState.result = { fetching: true, data: null, error: null };
    const { rerender } = render(
      <KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />,
    );
    expect(screen.getByText("Loading graph...")).toBeTruthy();

    urqlState.result = {
      fetching: false,
      data: null,
      error: { message: "stale thread error" },
    };
    rerender(<KnowledgeGraph tenantId="tenant-1" threadId={null} />);
    expect(
      await screen.findByText("Knowledge graph could not load."),
    ).toBeTruthy();
    expect(screen.getByText("stale thread error")).toBeTruthy();

    urqlState.result = {
      fetching: false,
      data: null,
      error: { message: "network down" },
    };
    rerender(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
    expect(
      await screen.findByText("Knowledge graph could not load."),
    ).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();
  });
});
