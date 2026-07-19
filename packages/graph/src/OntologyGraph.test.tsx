import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OntologyGraph,
  buildOntologyGraphData,
  mergeOntologyGraphData,
  ONTOLOGY_GHOST_CANDIDATE_CAP,
  type OntologyGraphData,
  type OntologyGraphHandle,
} from "./OntologyGraph.js";

const forceGraphCalls = vi.hoisted(() => [] as any[]);
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
        d3Force: () => ({
          strength: () => ({ distanceMax: vi.fn() }),
          distance: vi.fn(),
        }),
        graphData: vi.fn(),
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

function entityCandidate(i: number, evidenceCount = 1) {
  return {
    itemId: `item-${i}`,
    changeSetId: "cs-1",
    itemType: "ENTITY_TYPE",
    slug: `proposed-${i}`,
    proposedValue: { slug: `proposed-${i}`, name: `Proposed ${i}` },
    editedValue: null,
    evidenceCount,
    origin: "suggestion_engine",
    status: "PENDING_REVIEW",
  };
}

const baseGraph = {
  tenantId: "tenant-1",
  types: [
    {
      slug: "customer",
      name: "Customer",
      instanceCount: 40,
      lifecycleStatus: "APPROVED",
    },
    {
      slug: "person",
      name: "Person",
      instanceCount: 12,
      lifecycleStatus: "APPROVED",
    },
    {
      slug: "commitment",
      name: "Commitment",
      instanceCount: 3,
      lifecycleStatus: "APPROVED",
    },
  ],
  relationships: [
    {
      slug: "customer_has_commitment",
      name: "Customer has commitment",
      sourceTypeSlugs: ["customer"],
      targetTypeSlugs: ["commitment"],
    },
  ],
  candidates: [
    entityCandidate(1, 4),
    {
      itemId: "item-rel",
      changeSetId: "cs-1",
      itemType: "RELATIONSHIP_TYPE",
      slug: "commitment_owned_by",
      proposedValue: {
        slug: "commitment_owned_by",
        name: "Commitment owned by",
        sourceTypeSlugs: ["commitment"],
        targetTypeSlugs: ["person"],
      },
      editedValue: null,
      evidenceCount: 2,
      origin: "suggestion_engine",
      status: "PENDING_REVIEW",
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

function makeCtx(record: {
  fillAlpha?: number;
  texts: string[];
  dashes: number[][];
}) {
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
    setLineDash(segments: number[]) {
      record.dashes.push(segments);
    },
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

function paintNode(props: any, node: any) {
  const record = { fillAlpha: -1, texts: [] as string[], dashes: [] };
  props.nodeCanvasObject({ ...node, x: 0, y: 0 }, makeCtx(record) as any, 1);
  return record;
}

async function renderGraph(
  graph: any = baseGraph,
  extraProps: Record<string, any> = {},
) {
  urqlState.result = {
    fetching: false,
    data: { ontologySchemaGraph: graph },
    error: null,
  };
  const view = render(<OntologyGraph tenantId="tenant-1" {...extraProps} />);
  await screen.findByTestId("force-graph");
  return { view, props: latestForceGraphProps() };
}

describe("buildOntologyGraphData", () => {
  it("classifies approved types as solid nodes and candidates as ghosts", () => {
    const data = buildOntologyGraphData(baseGraph);

    const typeNodes = data.nodes.filter((node) => node.kind === "type");
    const ghostNodes = data.nodes.filter((node) => node.kind === "candidate");
    expect(typeNodes.map((node) => node.id)).toEqual([
      "type:customer",
      "type:person",
      "type:commitment",
    ]);
    expect(typeNodes[0]).toMatchObject({
      label: "Customer",
      instanceCount: 40,
      lifecycleStatus: "APPROVED",
    });
    expect(ghostNodes).toHaveLength(1);
    expect(ghostNodes[0]).toMatchObject({
      id: "candidate:item-1",
      label: "Proposed 1",
      evidenceCount: 4,
      itemId: "item-1",
      changeSetId: "cs-1",
    });
  });

  it("renders relationship candidates as ghost edges when both endpoints exist", () => {
    const data = buildOntologyGraphData(baseGraph);

    const approvedEdges = data.links.filter(
      (link) => link.kind === "relationship",
    );
    const ghostEdges = data.links.filter((link) => link.kind === "candidate");
    expect(approvedEdges).toHaveLength(1);
    expect(approvedEdges[0]).toMatchObject({
      label: "Customer has commitment",
      source: "type:customer",
      target: "type:commitment",
    });
    expect(ghostEdges).toHaveLength(1);
    expect(ghostEdges[0]).toMatchObject({
      id: "candidate:item-rel:commitment->person",
      source: "type:commitment",
      target: "type:person",
      evidenceCount: 2,
    });
    // No ghost NODE for the placeable relationship candidate.
    expect(
      data.nodes.find((node) => node.itemId === "item-rel"),
    ).toBeUndefined();
  });

  it("falls back to a ghost node when a relationship endpoint is missing", () => {
    const graph = {
      ...baseGraph,
      candidates: [
        {
          ...baseGraph.candidates[1],
          itemId: "item-dangling",
          proposedValue: {
            slug: "owned_by_ghost",
            name: "Owned by ghost",
            sourceTypeSlugs: ["commitment"],
            targetTypeSlugs: ["nonexistent-type"],
          },
        },
      ],
    };
    const data = buildOntologyGraphData(graph);

    expect(data.links.filter((link) => link.kind === "candidate")).toHaveLength(
      0,
    );
    expect(
      data.nodes.find((node) => node.itemId === "item-dangling"),
    ).toMatchObject({ kind: "candidate", label: "Owned by ghost" });
  });

  it("prefers editedValue over proposedValue and parses AWSJSON strings", () => {
    const graph = {
      ...baseGraph,
      candidates: [
        {
          ...entityCandidate(9),
          proposedValue: JSON.stringify({ slug: "x", name: "Original" }),
          editedValue: JSON.stringify({ slug: "x", name: "Edited name" }),
        },
      ],
    };
    const data = buildOntologyGraphData(graph);
    expect(data.nodes.find((node) => node.kind === "candidate")?.label).toBe(
      "Edited name",
    );
  });

  it("caps ghost candidates at 30 and reports the overflow (R18)", () => {
    const graph = {
      ...baseGraph,
      candidates: Array.from({ length: 45 }, (_, i) => entityCandidate(i)),
    };
    const data = buildOntologyGraphData(graph);

    expect(ONTOLOGY_GHOST_CANDIDATE_CAP).toBe(30);
    expect(data.nodes.filter((node) => node.kind === "candidate")).toHaveLength(
      30,
    );
    expect(data.overflow).toBe(15);
  });
});

describe("mergeOntologyGraphData (R17)", () => {
  it("mutates the arrays in place, preserving node object identity", () => {
    const target: OntologyGraphData = { nodes: [], links: [] };
    const nodesArray = target.nodes;
    const linksArray = target.links;

    mergeOntologyGraphData(target, baseGraph);
    const customer = target.nodes.find((node) => node.id === "type:customer")!;
    const ghost = target.nodes.find((node) => node.id === "candidate:item-1")!;
    // Simulate the d3 engine hydrating positions onto the live objects.
    (customer as any).x = 12;
    (customer as any).y = -7;
    (customer as any).vx = 0.4;

    const nextGraph = {
      ...baseGraph,
      types: [
        { ...baseGraph.types[0], instanceCount: 41 },
        ...baseGraph.types.slice(1),
      ],
      candidates: [...baseGraph.candidates, entityCandidate(99)],
    };
    mergeOntologyGraphData(target, nextGraph);

    // Same arrays, same surviving objects — the sim never restarts.
    expect(target.nodes).toBe(nodesArray);
    expect(target.links).toBe(linksArray);
    expect(target.nodes.find((node) => node.id === "type:customer")).toBe(
      customer,
    );
    expect(target.nodes.find((node) => node.id === "candidate:item-1")).toBe(
      ghost,
    );
    // Positions survive, fields refresh, the arrival appears.
    expect((customer as any).x).toBe(12);
    expect((customer as any).vx).toBe(0.4);
    expect(customer.instanceCount).toBe(41);
    expect(
      target.nodes.find((node) => node.id === "candidate:item-99"),
    ).toBeTruthy();
  });

  it("removes vanished candidates without touching survivors", () => {
    const target: OntologyGraphData = { nodes: [], links: [] };
    mergeOntologyGraphData(target, baseGraph);
    const person = target.nodes.find((node) => node.id === "type:person")!;

    mergeOntologyGraphData(target, { ...baseGraph, candidates: [] });

    expect(
      target.nodes.find((node) => node.kind === "candidate"),
    ).toBeUndefined();
    expect(
      target.links.find((link) => link.kind === "candidate"),
    ).toBeUndefined();
    expect(target.nodes.find((node) => node.id === "type:person")).toBe(person);
  });
});

describe("OntologyGraph", () => {
  it("renders approved types solid and candidates as dashed ghosts with a badge", async () => {
    const { props } = await renderGraph();

    expect(props.graphData.nodes).toHaveLength(4); // 3 types + 1 ghost
    expect(props.graphData.links).toHaveLength(2); // 1 approved + 1 ghost edge

    const typeNode = props.graphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    const ghostNode = props.graphData.nodes.find(
      (node: any) => node.kind === "candidate",
    );

    const solid = paintNode(props, typeNode);
    expect(solid.dashes).toEqual([]); // solid disc, no dashed ring
    expect(solid.fillAlpha).toBe(1);

    const ghost = paintNode(props, ghostNode);
    expect(ghost.dashes.length).toBeGreaterThan(0); // dashed ring drawn
    expect(ghost.fillAlpha).toBeLessThan(1); // faint ghost fill
    expect(ghost.texts).toContain("4"); // evidence-count badge
  });

  it("enforces the 30-ghost cap and fires onCandidateOverflow with the rest (R18)", async () => {
    const onCandidateOverflow = vi.fn();
    const graph = {
      ...baseGraph,
      relationships: [],
      candidates: Array.from({ length: 45 }, (_, i) => entityCandidate(i)),
    };
    const { props } = await renderGraph(graph, { onCandidateOverflow });

    expect(
      props.graphData.nodes.filter((node: any) => node.kind === "candidate"),
    ).toHaveLength(30);
    await waitFor(() => expect(onCandidateOverflow).toHaveBeenCalledWith(15));
  });

  it("preserves graphData and node identity across a refetch that adds a candidate (R17)", async () => {
    const { view, props } = await renderGraph();
    const firstGraphData = props.graphData;
    const customerNode = firstGraphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    expect(customerNode).toBeTruthy();

    urqlState.result = {
      fetching: false,
      data: {
        ontologySchemaGraph: {
          ...baseGraph,
          candidates: [...baseGraph.candidates, entityCandidate(2)],
        },
      },
      error: null,
    };
    view.rerender(<OntologyGraph tenantId="tenant-1" />);
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();

    // The R17 proof: identical container object, identical arrays, and the
    // surviving node is the SAME object reference — only the arrival is new.
    expect(nextProps.graphData).toBe(firstGraphData);
    expect(nextProps.graphData.nodes).toBe(firstGraphData.nodes);
    expect(
      nextProps.graphData.nodes.find(
        (node: any) => node.id === "type:customer",
      ),
    ).toBe(customerNode);
    expect(
      nextProps.graphData.nodes.find(
        (node: any) => node.id === "candidate:item-2",
      ),
    ).toBeTruthy();
  });

  it("dims in place for search without rebuilding graphData (R3)", async () => {
    const { view, props } = await renderGraph();
    const firstGraphData = props.graphData;
    const firstPainter = props.nodeCanvasObject;

    view.rerender(<OntologyGraph tenantId="tenant-1" searchQuery="Customer" />);
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();

    expect(nextProps.graphData).toBe(firstGraphData);
    expect(nextProps.nodeCanvasObject).toBe(firstPainter);
    const matched = firstGraphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    const dimmed = firstGraphData.nodes.find(
      (node: any) => node.id === "type:person",
    );
    expect(paintNode(nextProps, matched).fillAlpha).toBe(1);
    expect(paintNode(nextProps, dimmed).fillAlpha).toBe(0.15);
  });

  it("renders 4 baseline nodes for an empty tenant without crashing", async () => {
    const baseline = {
      tenantId: "tenant-1",
      types: ["person", "organization", "project", "document"].map((slug) => ({
        slug,
        name: slug[0]!.toUpperCase() + slug.slice(1),
        instanceCount: 0,
        lifecycleStatus: "APPROVED",
      })),
      relationships: [],
      candidates: [],
    };
    const { props } = await renderGraph(baseline);

    expect(props.graphData.nodes).toHaveLength(4);
    expect(props.graphData.links).toHaveLength(0);
    expect(
      props.graphData.nodes.every((node: any) => node.kind === "type"),
    ).toBe(true);
  });

  it("renders a skeleton while the query is in flight", () => {
    urqlState.result = { fetching: true, data: null, error: null };
    render(<OntologyGraph tenantId="tenant-1" />);
    expect(screen.getByTestId("ontology-graph-loading")).toBeTruthy();
    expect(screen.getByText("Loading ontology map...")).toBeTruthy();
  });

  it("renders an inline error with a working retry", async () => {
    urqlState.result = {
      fetching: false,
      data: null,
      error: { message: "network down" },
    };
    render(<OntologyGraph tenantId="tenant-1" />);

    expect(screen.getByText("Ontology map could not load.")).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(urqlState.reexecute).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("exposes an imperative refetch handle for the review rail", async () => {
    const graphRef = React.createRef<OntologyGraphHandle>();
    await renderGraph(baseGraph, { ref: graphRef });

    graphRef.current?.refetch();
    expect(urqlState.reexecute).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });
});
