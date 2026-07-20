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
  ontologyLinkLabelMidpoint,
  ontologyNodeMatchesFilters,
  ONTOLOGY_GHOST_CANDIDATE_CAP,
  type OntologyGraphData,
  type OntologyGraphLink,
  type OntologyGraphHandle,
  type OntologyGraphNode,
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
    quadraticCurveTo() {},
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

/**
 * The visual side a link occupies, expressed in its pair's canonical
 * orientation (lexicographically smaller endpoint first). react-force-graph
 * offsets the control point perpendicular to the SOURCE→TARGET direction,
 * so a link running against canonical order flips sign — two links on
 * opposite absolute sides always have opposite canonical sides.
 */
function canonicalSide(link: OntologyGraphLink): number {
  const source = String(link.source);
  const target = String(link.target);
  return (source <= target ? link.curvature : -link.curvature) || 0;
}

describe("ontologyNodeMatchesFilters", () => {
  const typeNode = (
    overrides: Partial<OntologyGraphNode> = {},
  ): OntologyGraphNode => ({
    id: "type:customer",
    kind: "type",
    slug: "customer",
    label: "Customer",
    instanceCount: 40,
    evidenceCount: 0,
    lifecycleStatus: "APPROVED",
    itemId: null,
    changeSetId: null,
    itemType: null,
    origin: null,
    ...overrides,
  });
  const ghostNode = (
    overrides: Partial<OntologyGraphNode> = {},
  ): OntologyGraphNode => ({
    id: "candidate:item-1",
    kind: "candidate",
    slug: "work_order",
    label: "Work Order",
    instanceCount: 0,
    evidenceCount: 4,
    lifecycleStatus: null,
    itemId: "item-1",
    changeSetId: "cs-1",
    itemType: "ENTITY_TYPE",
    origin: "suggestion_engine",
    ...overrides,
  });

  it("matches everything when no filters are set", () => {
    expect(ontologyNodeMatchesFilters(typeNode(), {})).toBe(true);
    expect(ontologyNodeMatchesFilters(ghostNode(), {})).toBe(true);
  });

  it("classifies status as approved types vs proposed ghosts", () => {
    const filters = { statusFilter: ["approved"] };
    expect(ontologyNodeMatchesFilters(typeNode(), filters)).toBe(true);
    expect(ontologyNodeMatchesFilters(ghostNode(), filters)).toBe(false);
    const proposed = { statusFilter: ["proposed"] };
    expect(ontologyNodeMatchesFilters(typeNode(), proposed)).toBe(false);
    expect(ontologyNodeMatchesFilters(ghostNode(), proposed)).toBe(true);
  });

  it("matches origin only for candidates carrying that provenance", () => {
    const filters = { originFilter: ["suggestion_engine"] };
    expect(ontologyNodeMatchesFilters(ghostNode(), filters)).toBe(true);
    expect(
      ontologyNodeMatchesFilters(ghostNode({ origin: "user" }), filters),
    ).toBe(false);
    // Approved types have no origin — they never match an origin filter.
    expect(ontologyNodeMatchesFilters(typeNode(), filters)).toBe(false);
  });

  it("splits evidence into has_evidence vs none", () => {
    const has = { evidenceFilter: ["has_evidence"] };
    expect(ontologyNodeMatchesFilters(ghostNode(), has)).toBe(true);
    expect(
      ontologyNodeMatchesFilters(ghostNode({ evidenceCount: 0 }), has),
    ).toBe(false);
    expect(ontologyNodeMatchesFilters(typeNode(), has)).toBe(false);
    expect(
      ontologyNodeMatchesFilters(typeNode(), { evidenceFilter: ["none"] }),
    ).toBe(true);
  });

  it("splits activity into has_instances vs empty", () => {
    const active = { activityFilter: ["has_instances"] };
    expect(ontologyNodeMatchesFilters(typeNode(), active)).toBe(true);
    expect(
      ontologyNodeMatchesFilters(typeNode({ instanceCount: 0 }), active),
    ).toBe(false);
    expect(ontologyNodeMatchesFilters(ghostNode(), active)).toBe(false);
    expect(
      ontologyNodeMatchesFilters(ghostNode(), { activityFilter: ["empty"] }),
    ).toBe(true);
  });

  it("ANDs multiple facets together", () => {
    const filters = {
      statusFilter: ["proposed"],
      originFilter: ["suggestion_engine"],
      evidenceFilter: ["has_evidence"],
    };
    expect(ontologyNodeMatchesFilters(ghostNode(), filters)).toBe(true);
    expect(
      ontologyNodeMatchesFilters(ghostNode({ evidenceCount: 0 }), filters),
    ).toBe(false);
  });
});

describe("link curvature assignment", () => {
  const bidirectionalGraph = {
    ...baseGraph,
    candidates: [],
    relationships: [
      {
        slug: "involves_person",
        name: "Involves person",
        sourceTypeSlugs: ["customer"],
        targetTypeSlugs: ["person"],
      },
      {
        slug: "has_customer",
        name: "Has customer",
        sourceTypeSlugs: ["person"],
        targetTypeSlugs: ["customer"],
      },
    ],
  };

  it("keeps a single link between a pair perfectly straight", () => {
    const data = buildOntologyGraphData(baseGraph);
    // Approved customer->commitment and ghost commitment->person are each
    // the only link on their pair.
    expect(data.links).toHaveLength(2);
    for (const link of data.links) expect(link.curvature).toBe(0);
  });

  it("arcs a bidirectional pair to opposite sides with +/-0.2 (stable under shuffled input)", () => {
    const data = buildOntologyGraphData(bidirectionalGraph);
    const involves = data.links.find(
      (link) => link.slug === "involves_person",
    )!;
    const has = data.links.find((link) => link.slug === "has_customer")!;

    const sides = [canonicalSide(involves), canonicalSide(has)].sort();
    expect(sides).toEqual([-0.2, 0.2]);
    // Opposite absolute sides — the arcs never overlap.
    expect(canonicalSide(involves)).toBe(-canonicalSide(has));

    // Assignment is keyed on sorted link ids, not payload order: the same
    // pair shuffled produces identical per-link curvature.
    const shuffled = buildOntologyGraphData({
      ...bidirectionalGraph,
      relationships: [...bidirectionalGraph.relationships].reverse(),
    });
    for (const link of data.links) {
      expect(
        shuffled.links.find((other) => other.id === link.id)?.curvature,
      ).toBe(link.curvature);
    }
  });

  it("spreads three parallel links across distinct arcs in [-0.3, 0.3]", () => {
    const graph = {
      ...baseGraph,
      candidates: [],
      relationships: ["assigned_to", "owned_by", "reviewed_by"].map((slug) => ({
        slug,
        name: slug,
        sourceTypeSlugs: ["customer"],
        targetTypeSlugs: ["commitment"],
      })),
    };
    const data = buildOntologyGraphData(graph);

    expect(data.links).toHaveLength(3);
    const sides = data.links.map(canonicalSide).sort((a, b) => a - b);
    expect(sides).toEqual([-0.3, 0, 0.3]);
    expect(new Set(data.links.map((link) => link.curvature)).size).toBe(3);
  });

  it("separates a ghost candidate edge running parallel to an approved edge", () => {
    const graph = {
      ...baseGraph,
      candidates: [
        {
          ...baseGraph.candidates[1],
          proposedValue: {
            slug: "commitment_of",
            name: "Commitment of",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["commitment"],
          },
        },
      ],
    };
    const data = buildOntologyGraphData(graph);

    const approved = data.links.find((link) => link.kind === "relationship")!;
    const ghost = data.links.find((link) => link.kind === "candidate")!;
    expect(canonicalSide(approved)).not.toBe(0);
    expect(canonicalSide(ghost)).not.toBe(0);
    expect(canonicalSide(approved)).toBe(-canonicalSide(ghost));
  });

  it("survives an in-place merge with link identity and curvature intact (R17)", () => {
    const target: OntologyGraphData = { nodes: [], links: [] };
    mergeOntologyGraphData(target, bidirectionalGraph);
    const involves = target.links.find(
      (link) => link.slug === "involves_person",
    )!;
    const curvatureBefore = involves.curvature;
    expect(curvatureBefore).not.toBe(0);
    // Simulate the engine hydrating endpoint strings into node objects.
    (involves as any).source = target.nodes.find(
      (node) => node.id === "type:customer",
    );
    (involves as any).target = target.nodes.find(
      (node) => node.id === "type:person",
    );

    mergeOntologyGraphData(target, {
      ...bidirectionalGraph,
      candidates: [entityCandidate(7)],
    });

    const survivor = target.links.find(
      (link) => link.slug === "involves_person",
    )!;
    expect(survivor).toBe(involves); // same object — sim never restarts
    expect(survivor.curvature).toBe(curvatureBefore);
  });

  it("ontologyLinkLabelMidpoint returns the quadratic bezier midpoint", () => {
    // Control point sits perpendicular at curvature*length; B(0.5) is the
    // chord midpoint pushed half that far along the normal.
    expect(
      ontologyLinkLabelMidpoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.2),
    ).toEqual({ x: 5, y: -1 });
    expect(
      ontologyLinkLabelMidpoint({ x: 0, y: 0 }, { x: 10, y: 0 }, -0.2),
    ).toEqual({ x: 5, y: 1 });
    // Straight link degenerates to the chord midpoint.
    expect(
      ontologyLinkLabelMidpoint({ x: 2, y: 2 }, { x: 6, y: 10 }, 0),
    ).toEqual({ x: 4, y: 6 });
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

    // The engine container must be a FRESH object per data merge — the
    // react wrapper shallow-compares the graphData prop, so a stable
    // container would never re-ingest and live arrivals would neither
    // render nor hit-test (no simulation coordinates). The R17 no-restart
    // invariant lives one level down: the ARRAYS and every surviving node
    // OBJECT keep their identity, so positions/velocities carry over.
    expect(nextProps.graphData).not.toBe(firstGraphData);
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

  it("dims in place for facet filters without rebuilding graphData (R3)", async () => {
    const { view, props } = await renderGraph();
    const firstGraphData = props.graphData;

    view.rerender(
      <OntologyGraph tenantId="tenant-1" statusFilter={["approved"]} />,
    );
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();

    expect(nextProps.graphData).toBe(firstGraphData);
    const approved = firstGraphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    const ghost = firstGraphData.nodes.find(
      (node: any) => node.id === "candidate:item-1",
    );
    expect(paintNode(nextProps, approved).fillAlpha).toBe(1);
    // Ghost fills at alpha * 0.25 — dimmed ghosts land at 0.15 * 0.25.
    expect(paintNode(nextProps, ghost).fillAlpha).toBeCloseTo(0.0375);

    // Proposed-only flips the dimming to the approved side.
    view.rerender(
      <OntologyGraph tenantId="tenant-1" statusFilter={["proposed"]} />,
    );
    const proposedProps = latestForceGraphProps();
    expect(paintNode(proposedProps, approved).fillAlpha).toBe(0.15);
    expect(paintNode(proposedProps, ghost).fillAlpha).toBeCloseTo(0.25);
  });

  it("intersects search with facet filters", async () => {
    const { view, props } = await renderGraph();
    const firstGraphData = props.graphData;

    // "Customer" matches by name but is dimmed once status=proposed.
    view.rerender(
      <OntologyGraph
        tenantId="tenant-1"
        searchQuery="Customer"
        statusFilter={["proposed"]}
      />,
    );
    await waitFor(() => expect(forceGraphCalls.length).toBeGreaterThan(1));
    const nextProps = latestForceGraphProps();
    const customer = firstGraphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    expect(paintNode(nextProps, customer).fillAlpha).toBe(0.15);
  });

  it("reports distinct candidate origins via onOriginsLoaded", async () => {
    const onOriginsLoaded = vi.fn();
    await renderGraph(baseGraph, { onOriginsLoaded });

    // item-1 is a ghost node (origin suggestion_engine); item-rel renders
    // as a ghost edge, so only node origins are reported.
    expect(onOriginsLoaded).toHaveBeenCalledWith(["suggestion_engine"]);
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

/**
 * Selected-node chip (Memory/Wiki graph parity): a canvas node click only
 * focus-dims in place and surfaces the top-right "<label> View details"
 * chip; `onNodeClick` fires from the chip, never from the canvas click.
 * The pointer geometry rides useGraphPointer with the identity
 * screen2GraphCoords of the engine mock, so a click at a node's (x, y)
 * hit-tests that node.
 */
describe("OntologyGraph selected-node chip", () => {
  async function renderWithNodeAt(onNodeClick: ReturnType<typeof vi.fn>) {
    const { props } = await renderGraph(baseGraph, { onNodeClick });
    // Give every node simulation coordinates so hit-testing can work;
    // park the customer node at (100, 100), far from the others.
    for (const [i, node] of (props.graphData.nodes as any[]).entries()) {
      node.x = 400 + i * 60;
      node.y = 400;
    }
    const target = props.graphData.nodes.find(
      (node: any) => node.id === "type:customer",
    );
    target.x = 100;
    target.y = 100;
    const container = screen.getByTestId("graph-container");
    return { container, target };
  }

  it("shows the chip on node click without firing onNodeClick", async () => {
    const onNodeClick = vi.fn();
    const { container } = await renderWithNodeAt(onNodeClick);

    fireEvent.click(container, { clientX: 100, clientY: 100 });

    expect(
      screen.getByRole("button", { name: "Open details for Customer" }),
    ).toBeTruthy();
    expect(screen.getByText("View details")).toBeTruthy();
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("fires onNodeClick with the selected node from the chip's View details", async () => {
    const onNodeClick = vi.fn();
    const { container, target } = await renderWithNodeAt(onNodeClick);

    fireEvent.click(container, { clientX: 100, clientY: 100 });
    fireEvent.click(
      screen.getByRole("button", { name: "Open details for Customer" }),
    );

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]![0]).toBe(target);
  });

  it("moves the chip to another node and clears it on background click", async () => {
    const onNodeClick = vi.fn();
    const { container } = await renderWithNodeAt(onNodeClick);
    const other = latestForceGraphProps().graphData.nodes.find(
      (node: any) => node.id === "type:person",
    );
    other.x = 200;
    other.y = 200;

    fireEvent.click(container, { clientX: 100, clientY: 100 });
    fireEvent.click(container, { clientX: 200, clientY: 200 });
    expect(
      screen.getByRole("button", { name: "Open details for Person" }),
    ).toBeTruthy();

    // Background: nowhere near any node.
    fireEvent.click(container, { clientX: 10, clientY: 10 });
    expect(screen.queryByText("View details")).toBeNull();
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("clears focus and chip on Escape", async () => {
    const onNodeClick = vi.fn();
    const { container } = await renderWithNodeAt(onNodeClick);

    fireEvent.click(container, { clientX: 100, clientY: 100 });
    expect(screen.getByText("View details")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("View details")).toBeNull();
  });
});
