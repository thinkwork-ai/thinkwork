import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeGraph,
  buildKnowledgeGraphData,
  knowledgeGraphTrustColor,
  knowledgeGraphTrustState,
  type KnowledgeGraphHandle,
} from "./KnowledgeGraph.js";

const forceGraphCalls = vi.hoisted(() => [] as any[]);
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

    props.onNodeClick(props.graphData.nodes[1]);

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
