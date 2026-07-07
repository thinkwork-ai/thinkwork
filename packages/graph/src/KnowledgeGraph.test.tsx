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
        d3Force: (name: string, force?: any) => {
          d3ForceCalls.push({ name, force });
          return {
            strength: () => ({ distanceMax: vi.fn() }),
            distance: vi.fn(),
          };
        },
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

function makeCtx(record: { fillAlpha?: number; texts: string[] }) {
  let currentAlpha = 1;
  return {
    set globalAlpha(v: number) {
      currentAlpha = v;
    },
    get globalAlpha() {
      return currentAlpha;
    },
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      if (record.fillAlpha === undefined || record.fillAlpha === -1) {
        record.fillAlpha = currentAlpha;
      }
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
}

/** Paint a node and capture fill alpha + label lines. */
function paintNode(props: any, node: any) {
  const record = { fillAlpha: -1, texts: [] as string[] };
  props.nodeCanvasObject({ ...node, x: 0, y: 0 }, makeCtx(record) as any, 1);
  return record;
}

/** Paint a link and capture any inline label text. */
function paintLink(props: any, link: any) {
  const record = { texts: [] as string[] };
  props.linkCanvasObject(link, makeCtx(record) as any, 1);
  return record.texts;
}

/** Hydrate a link's endpoints to positioned objects (as the sim would). */
function hydrateLink(link: any) {
  return {
    ...link,
    source: { id: link.source, x: 0, y: 0 },
    target: { id: link.target, x: 160, y: 0 },
  };
}

async function renderGraph(extraProps: Record<string, any> = {}) {
  urqlState.result = {
    fetching: false,
    data: { knowledgeGraphGraph: graphFixture },
    error: null,
  };
  const view = render(
    <KnowledgeGraph tenantId="tenant-1" threadId="thread-1" {...extraProps} />,
  );
  await screen.findByTestId("force-graph");
  return { view, props: latestForceGraphProps() };
}

describe("KnowledgeGraph", () => {
  it("maps knowledgeGraphGraph nodes and edges into ForceGraph data", async () => {
    const { props } = await renderGraph();

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

  it("does not rebuild graph data or reset painters for local filters", async () => {
    const { view, props } = await renderGraph();
    const firstGraphData = props.graphData;
    const firstPainter = props.nodeCanvasObject;

    view.rerender(
      <KnowledgeGraph
        tenantId="tenant-1"
        threadId="thread-1"
        searchQuery="Acme"
      />,
    );
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();

    expect(nextProps.graphData).toBe(firstGraphData);
    expect(nextProps.nodeCanvasObject).toBe(firstPainter);
    // Search dims non-matches through the same painter.
    expect(paintNode(nextProps, firstGraphData.nodes[0]).fillAlpha).toBe(1);
    expect(paintNode(nextProps, firstGraphData.nodes[2]).fillAlpha).toBe(0.15);
  });

  it("registers community cluster forces at data cadence, not filter cadence", async () => {
    const { view } = await renderGraph();

    const clusterForceCalls = () =>
      d3ForceCalls.filter((call) => call.name === "x" || call.name === "y")
        .length;
    const centerRemovals = d3ForceCalls.filter(
      (call) => call.name === "center" && call.force === null,
    );
    const initialClusterCalls = clusterForceCalls();
    expect(initialClusterCalls).toBeGreaterThanOrEqual(2);
    expect(centerRemovals.length).toBeGreaterThanOrEqual(1);

    view.rerender(
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

  it("opens the detail sheet from the selected-node chip with connected edges", async () => {
    const graphRef = React.createRef<KnowledgeGraphHandle>();
    const onNodeClick = vi.fn();
    const { props } = await renderGraph({ ref: graphRef, onNodeClick });

    // Node click surfaces the chip without opening the sheet.
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
    it("clicking a node lights its direct neighborhood (1 degree)", async () => {
      const { props } = await renderGraph();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });

      // entity-1 -> entity-2 -> entity-3 is a chain: 1 degree from
      // entity-1 lights entity-2 but not entity-3.
      const latest = latestForceGraphProps();
      expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(1);
      expect(paintNode(latest, props.graphData.nodes[1]).fillAlpha).toBe(1);
      expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(0.15);
      expect(screen.queryByText("Showing direct connections only")).toBeNull();
    });

    it("background click clears focus and restores prior state (AE4)", async () => {
      const { props } = await renderGraph();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      await act(async () => {
        latestForceGraphProps().onBackgroundClick();
      });

      const latest = latestForceGraphProps();
      for (const node of props.graphData.nodes) {
        expect(paintNode(latest, node).fillAlpha).toBe(1);
      }
    });

    it("focus supersedes search dimming and exit restores it (AE5)", async () => {
      const { view, props } = await renderGraph();

      view.rerender(
        <KnowledgeGraph
          tenantId="tenant-1"
          threadId="thread-1"
          searchQuery="Beta"
        />,
      );
      await waitFor(() =>
        expect(
          paintNode(latestForceGraphProps(), props.graphData.nodes[0])
            .fillAlpha,
        ).toBe(0.15),
      );

      await act(async () => {
        latestForceGraphProps().onNodeClick(props.graphData.nodes[0]);
      });
      expect(
        paintNode(latestForceGraphProps(), props.graphData.nodes[0]).fillAlpha,
      ).toBe(1);

      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      const restored = latestForceGraphProps();
      expect(paintNode(restored, props.graphData.nodes[0]).fillAlpha).toBe(
        0.15,
      );
      expect(paintNode(restored, props.graphData.nodes[2]).fillAlpha).toBe(1);
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

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      expect(
        paintNode(latestForceGraphProps(), props.graphData.nodes[2]).fillAlpha,
      ).toBe(0.15);

      await act(async () => {
        latestForceGraphProps().onNodeClick(props.graphData.nodes[2]);
      });
      const latest = latestForceGraphProps();
      expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(1);
      expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(0.15);
    });

    it("focusing an isolated node lights only it, no truncation chip (AE8)", async () => {
      const isolatedFixture = {
        nodes: graphFixture.nodes,
        edges: [graphFixture.edges[0]],
      };
      urqlState.result = {
        fetching: false,
        data: { knowledgeGraphGraph: isolatedFixture },
        error: null,
      };
      render(<KnowledgeGraph tenantId="tenant-1" threadId="thread-1" />);
      await screen.findByTestId("force-graph");
      const props = latestForceGraphProps();

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[2]);
      });

      const latest = latestForceGraphProps();
      expect(paintNode(latest, props.graphData.nodes[0]).fillAlpha).toBe(0.15);
      expect(paintNode(latest, props.graphData.nodes[2]).fillAlpha).toBe(1);
      expect(screen.queryByText("Showing direct connections only")).toBeNull();
    });

    it("hub focus lights all direct neighbors without a truncation chip", async () => {
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

      // Degree 1 is always accepted in full — no silent truncation.
      const latest = latestForceGraphProps();
      expect(paintNode(latest, props.graphData.nodes[1]).fillAlpha).toBe(1);
      expect(screen.queryByText("Showing direct connections only")).toBeNull();
    });

    it("focus changes rebuild nothing: same graphData, no force re-registration", async () => {
      const { props } = await renderGraph();
      const initialGraphData = props.graphData;
      const initialForceCalls = d3ForceCalls.length;

      await act(async () => {
        props.onNodeClick(props.graphData.nodes[1]);
      });

      const nextProps = latestForceGraphProps();
      expect(nextProps.graphData).toBe(initialGraphData);
      expect(d3ForceCalls.length).toBe(initialForceCalls);
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
      return latestForceGraphProps();
    }

    it("zoom gate shows labels close up and hides them far out (AE2)", async () => {
      const props = await renderLarge();
      const nodeA = props.graphData.nodes[0];

      // Zoomed in past the 1.2 gate.
      props.onZoom({ k: 1.5 });
      expect(paintNode(props, nodeA).texts.length).toBeGreaterThan(0);

      // Far zoom hides labels on a large graph.
      props.onZoom({ k: 0.3 });
      expect(paintNode(props, nodeA).texts.length).toBe(0);

      // Zooming back in restores them.
      props.onZoom({ k: 1.4 });
      expect(paintNode(props, nodeA).texts.length).toBeGreaterThan(0);
    });

    it("edge labels ride the line: zoom-gated in overview, lit-only in focus (R9/R10)", async () => {
      const props = await renderLarge();
      const litLink = hydrateLink(props.graphData.links[0]);

      // Far zoom on a large graph — gate closed, plain line only.
      props.onZoom({ k: 0.3 });
      expect(paintLink(props, litLink)).toEqual([]);

      // Zoomed in — the label becomes part of the line.
      props.onZoom({ k: 1.5 });
      expect(paintLink(props, litLink)).toEqual(["supports"]);

      // Focus "a": lit edge labeled at any zoom; node labels lit-only.
      props.onZoom({ k: 0.3 });
      await act(async () => {
        props.onNodeClick(props.graphData.nodes[0]);
      });
      const latest = latestForceGraphProps();
      expect(paintLink(latest, litLink)).toEqual(["supports"]);
      expect(
        paintNode(latest, props.graphData.nodes[0]).texts.length,
      ).toBeGreaterThan(0);
      expect(paintNode(latest, props.graphData.nodes[5]).texts.length).toBe(0);
    });

    it("the single Labels toggle overrides the gate in both directions (AE7/AE3)", async () => {
      const props = await renderLarge();
      props.onZoom({ k: 0.3 }); // gate closed
      const nodeA = props.graphData.nodes[0];
      const litLink = hydrateLink(props.graphData.links[0]);
      expect(paintNode(props, nodeA).texts.length).toBe(0);
      expect(paintLink(props, litLink)).toEqual([]);

      const toggle = () =>
        screen.getByRole("button", { name: "Toggle labels" });

      // auto -> on: node and relationship labels appear despite the gate.
      fireEvent.click(toggle());
      expect(
        paintNode(latestForceGraphProps(), nodeA).texts.length,
      ).toBeGreaterThan(0);
      expect(paintLink(latestForceGraphProps(), litLink)).toEqual(["supports"]);

      // on -> off hides both everywhere, even zoomed in.
      props.onZoom({ k: 2 });
      fireEvent.click(toggle());
      expect(paintNode(latestForceGraphProps(), nodeA).texts.length).toBe(0);
      expect(paintLink(latestForceGraphProps(), litLink)).toEqual([]);

      // off -> auto: gated behavior returns (zoomed in => visible).
      fireEvent.click(toggle());
      expect(
        paintNode(latestForceGraphProps(), nodeA).texts.length,
      ).toBeGreaterThan(0);
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
