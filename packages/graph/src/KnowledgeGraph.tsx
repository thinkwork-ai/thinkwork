/**
 * KnowledgeGraph — 3D force-graph rendering Cognee-derived thread entities.
 *
 * This intentionally follows WikiGraph's force-graph discipline: graphData
 * changes only when the server graph changes, while search/status filters
 * mutate material opacity in place. That keeps the d3 simulation and camera
 * stable while operators inspect weak or diagnostic Cognee output.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useQuery } from "urql";
import * as d3 from "d3-force";
import { KnowledgeGraphQuery } from "./queries.js";
import {
  classifyNode,
  deriveGraphClassification,
  endpointId,
  normalizeGraphSearch,
  type GraphClassification,
  type GraphEndpoint,
} from "./graph-utils.js";

export type KnowledgeGraphGroundingStatus =
  | "GROUNDED"
  | "UNAPPROVED_TYPE"
  | "UNGROUNDED"
  | "CONFLICT"
  | "UNKNOWN";

export type KnowledgeGraphProvenanceStatus = "STRONG" | "WEAK" | "MISSING";

export type KnowledgeGraphTrustState = "trusted" | "weak" | "diagnostic";

export interface KnowledgeGraphNode {
  id: string;
  entityId: string;
  label: string;
  nodeType: "entity";
  typeLabel: string | null;
  ontologyTypeSlug: string | null;
  groundingStatus: KnowledgeGraphGroundingStatus;
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  relationshipCount: number;
  evidenceCount: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  relationshipId: string;
  source: GraphEndpoint;
  target: GraphEndpoint;
  label: string;
  ontologyTypeSlug: string | null;
  groundingStatus: KnowledgeGraphGroundingStatus;
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  evidenceCount: number;
  weight: number;
}

export interface KnowledgeGraphConnectedEdge {
  label: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
  relationshipId: string;
  groundingStatus: KnowledgeGraphGroundingStatus;
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  evidenceCount: number;
}

export interface KnowledgeGraphHandle {
  refetch: () => void;
  getNodeWithEdges: (nodeId: string) => {
    node: KnowledgeGraphNode;
    edges: KnowledgeGraphConnectedEdge[];
  } | null;
}

interface KnowledgeGraphProps {
  tenantId: string;
  threadId: string | null;
  onNodeClick?: (
    node: KnowledgeGraphNode,
    connectedEdges: KnowledgeGraphConnectedEdge[],
  ) => void;
  onTypesLoaded?: (types: string[]) => void;
  searchQuery?: string;
  typeFilter?: string[];
  groundingStatusFilter?: KnowledgeGraphGroundingStatus[];
  provenanceStatusFilter?: KnowledgeGraphProvenanceStatus[];
  loadingFallback?: React.ReactNode;
  emptyFallback?: React.ReactNode;
  errorFallback?: (message: string) => React.ReactNode;
}

const TRUST_COLORS: Record<KnowledgeGraphTrustState, string> = {
  trusted: "#14b8a6",
  weak: "#f59e0b",
  diagnostic: "#a855f7",
};

const TRUST_LABELS: Record<KnowledgeGraphTrustState, string> = {
  trusted: "Trusted",
  weak: "Weak provenance",
  diagnostic: "Diagnostic",
};

export function knowledgeGraphTrustState(
  item: Pick<
    KnowledgeGraphNode | KnowledgeGraphEdge,
    "groundingStatus" | "provenanceStatus"
  >,
): KnowledgeGraphTrustState {
  if (item.provenanceStatus !== "STRONG") return "weak";
  if (item.groundingStatus === "GROUNDED") return "trusted";
  return "diagnostic";
}

export function knowledgeGraphTrustColor(
  item: Pick<
    KnowledgeGraphNode | KnowledgeGraphEdge,
    "groundingStatus" | "provenanceStatus"
  >,
): string {
  return TRUST_COLORS[knowledgeGraphTrustState(item)];
}

function matchesKnowledgeGraphFilters(
  node: KnowledgeGraphNode,
  {
    searchQuery,
    typeFilter,
    groundingStatusFilter,
    provenanceStatusFilter,
  }: Pick<
    KnowledgeGraphProps,
    | "searchQuery"
    | "typeFilter"
    | "groundingStatusFilter"
    | "provenanceStatusFilter"
  >,
): boolean {
  if (typeFilter && typeFilter.length > 0) {
    const type = node.typeLabel ?? node.ontologyTypeSlug ?? "Untyped";
    if (!new Set(typeFilter).has(type)) return false;
  }

  if (groundingStatusFilter && groundingStatusFilter.length > 0) {
    if (!new Set(groundingStatusFilter).has(node.groundingStatus)) {
      return false;
    }
  }

  if (provenanceStatusFilter && provenanceStatusFilter.length > 0) {
    if (!new Set(provenanceStatusFilter).has(node.provenanceStatus)) {
      return false;
    }
  }

  if (searchQuery) {
    const query = normalizeGraphSearch(searchQuery);
    const haystack = normalizeGraphSearch(
      [
        node.label,
        node.typeLabel,
        node.ontologyTypeSlug,
        node.groundingStatus,
        node.provenanceStatus,
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (!haystack.includes(query)) return false;
  }

  return true;
}

export function buildKnowledgeGraphData(graph: any): {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphEdge[];
} {
  const nodes: KnowledgeGraphNode[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph?.nodes ?? []) {
    const mapped: KnowledgeGraphNode = {
      id: node.id,
      entityId: node.entityId,
      label: node.label ?? node.id,
      nodeType: "entity",
      typeLabel: node.typeLabel ?? null,
      ontologyTypeSlug: node.ontologyTypeSlug ?? null,
      groundingStatus: node.groundingStatus ?? "UNKNOWN",
      provenanceStatus: node.provenanceStatus ?? "MISSING",
      relationshipCount: node.relationshipCount ?? 0,
      evidenceCount: node.evidenceCount ?? 0,
    };
    nodes.push(mapped);
    nodeIds.add(mapped.id);
  }

  const links: KnowledgeGraphEdge[] = [];
  for (const edge of graph?.edges ?? []) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    links.push({
      id: edge.id,
      relationshipId: edge.relationshipId,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? "related to",
      ontologyTypeSlug: edge.ontologyTypeSlug ?? null,
      groundingStatus: edge.groundingStatus ?? "UNKNOWN",
      provenanceStatus: edge.provenanceStatus ?? "MISSING",
      evidenceCount: edge.evidenceCount ?? 0,
      weight: Math.max(0.2, Math.min(1, (edge.evidenceCount ?? 1) / 5)),
    });
  }

  return { nodes, links };
}

export const KnowledgeGraph = forwardRef<
  KnowledgeGraphHandle,
  KnowledgeGraphProps
>(function KnowledgeGraph(
  {
    tenantId,
    threadId,
    onNodeClick,
    onTypesLoaded,
    searchQuery,
    typeFilter,
    groundingStatusFilter,
    provenanceStatusFilter,
    loadingFallback,
    emptyFallback,
    errorFallback,
  },
  ref,
) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [result, reexecute] = useQuery({
    query: KnowledgeGraphQuery,
    variables: { tenantId, threadId },
    pause: !tenantId || !threadId,
  });

  const graphData = useMemo(
    () => buildKnowledgeGraphData(result.data?.knowledgeGraphGraph),
    [result.data],
  );

  const prevTypesRef = useRef<string>("");
  useEffect(() => {
    if (!onTypesLoaded || graphData.nodes.length === 0) return;
    const sorted = Array.from(
      new Set(
        graphData.nodes.map(
          (node) => node.typeLabel ?? node.ontologyTypeSlug ?? "Untyped",
        ),
      ),
    ).sort();
    const key = sorted.join(",");
    if (key !== prevTypesRef.current) {
      prevTypesRef.current = key;
      onTypesLoaded(sorted);
    }
  }, [graphData.nodes, onTypesLoaded]);

  const hasFilter =
    !!searchQuery ||
    !!typeFilter?.length ||
    !!groundingStatusFilter?.length ||
    !!provenanceStatusFilter?.length;

  const matchedIds = useMemo(() => {
    if (!hasFilter) return null;
    return new Set(
      graphData.nodes
        .filter((node) =>
          matchesKnowledgeGraphFilters(node, {
            searchQuery,
            typeFilter,
            groundingStatusFilter,
            provenanceStatusFilter,
          }),
        )
        .map((node) => node.id),
    );
  }, [
    graphData.nodes,
    groundingStatusFilter,
    hasFilter,
    provenanceStatusFilter,
    searchQuery,
    typeFilter,
  ]);

  const classification = useMemo<GraphClassification | null>(
    () => deriveGraphClassification(matchedIds, graphData.links),
    [matchedIds, graphData.links],
  );
  const classificationRef = useRef<GraphClassification | null>(null);
  classificationRef.current = classification;

  const matchedIdsRef = useRef<Set<string> | null>(null);
  matchedIdsRef.current = matchedIds;

  const getNodeWithEdgesRef = useRef<KnowledgeGraphHandle["getNodeWithEdges"]>(
    () => null,
  );

  getNodeWithEdgesRef.current = (nodeId: string) => {
    const node = graphData.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    const edges = graphData.links
      .filter((link) => {
        const sourceId = endpointId(link.source);
        const targetId = endpointId(link.target);
        return sourceId === nodeId || targetId === nodeId;
      })
      .map((link) => {
        const sourceId = endpointId(link.source);
        const targetId = endpointId(link.target);
        const otherId = sourceId === nodeId ? targetId : sourceId;
        const otherNode = graphData.nodes.find(
          (candidate) => candidate.id === otherId,
        );
        return {
          label: link.label || "related to",
          targetLabel: otherNode?.label ?? otherId,
          targetType: otherNode?.nodeType ?? "entity",
          targetId: otherId,
          relationshipId: link.relationshipId,
          groundingStatus: link.groundingStatus,
          provenanceStatus: link.provenanceStatus,
          evidenceCount: link.evidenceCount,
        };
      });
    return { node, edges };
  };

  useImperativeHandle(ref, () => ({
    refetch: () => reexecute({ requestPolicy: "network-only" }),
    getNodeWithEdges: (nodeId: string) => getNodeWithEdgesRef.current(nodeId),
  }));

  useEffect(() => {
    if (!containerEl) return;
    const measure = () => {
      const w = containerEl.offsetWidth;
      const h = containerEl.offsetHeight;
      if (w > 0 && h > 0) setDims({ w, h });
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  const nodeThreeObject = useCallback((node: any) => {
    const state = classifyNode(node.id, classificationRef.current);
    const color = knowledgeGraphTrustColor(node);
    const rawLabel = node.label ?? "";
    const label =
      rawLabel.length > 16 ? rawLabel.slice(0, 15) + "..." : rawLabel;
    const degree = Math.max(
      node.relationshipCount ?? 0,
      node.evidenceCount ?? 0,
      1,
    );
    const r = Math.max(5, Math.min(18, 5 + Math.sqrt(degree) * 1.5));
    const sphereOp = state === "matched" ? 1 : 0.15;
    const ringOp = state === "neighbor" ? 1 : 0;

    const group = new THREE.Group();

    const geometry = new THREE.SphereGeometry(r, 16, 16);
    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: sphereOp,
    });
    group.add(new THREE.Mesh(geometry, material));

    const canvas = document.createElement("canvas");
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, size / 2, size / 2);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: sphereOp,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(r * 3, r * 3, 1);
    group.add(sprite);

    const ringCanvas = document.createElement("canvas");
    const ringSize = 128;
    ringCanvas.width = ringSize;
    ringCanvas.height = ringSize;
    const rCtx = ringCanvas.getContext("2d")!;
    rCtx.clearRect(0, 0, ringSize, ringSize);
    rCtx.strokeStyle = color;
    rCtx.lineWidth = 10;
    rCtx.beginPath();
    rCtx.arc(ringSize / 2, ringSize / 2, ringSize / 2 - 10, 0, Math.PI * 2);
    rCtx.stroke();
    const ringMaterial = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(ringCanvas),
      transparent: true,
      opacity: ringOp,
    });
    const ringSprite = new THREE.Sprite(ringMaterial);
    ringSprite.scale.set(r * 2, r * 2, 1);
    group.add(ringSprite);

    node.__sphereMat = material;
    node.__spriteMat = spriteMaterial;
    node.__ringMat = ringMaterial;

    return group;
  }, []);

  useEffect(() => {
    for (const node of graphData.nodes as any[]) {
      const state = classifyNode(node.id, classification);
      const opacity = state === "matched" ? 1 : 0.15;
      const ringOpacity = state === "neighbor" ? 1 : 0;
      if (node.__sphereMat) node.__sphereMat.opacity = opacity;
      if (node.__spriteMat) node.__spriteMat.opacity = opacity;
      if (node.__ringMat) node.__ringMat.opacity = ringOpacity;
    }
    fgRef.current?.refresh?.();
  }, [classification, graphData.nodes]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const nodeCount = graphData.nodes.length;
    fg.d3Force("charge")
      ?.strength(nodeCount > 50 ? -200 : -130)
      .distanceMax(200);
    fg.d3Force("link")?.distance(nodeCount > 50 ? 100 : 75);
    fg.d3Force("center")?.strength(1);
    fg.d3Force("collide", d3.forceCollide().radius(28).strength(0.8));
  }, [graphData]);

  const cameraInitRef = useRef(false);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !dims || cameraInitRef.current) return;
    const camera = fg.camera();
    const controls = fg.controls();
    const nodeCount = graphData.nodes.length;
    const initialZ = Math.max(800, Math.min(6000, 100 * Math.sqrt(nodeCount)));
    camera.position.set(0, 0, initialZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    controls.enableRotate = false;
    controls.panSpeed = 0.15;
    controls.zoomSpeed = 0.5;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    cameraInitRef.current = true;
  }, [dims, graphData]);

  const anyFetching = !!threadId && result.fetching && !result.data;
  if (anyFetching) {
    return (
      loadingFallback ?? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          Loading graph...
        </div>
      )
    );
  }

  if (!threadId) {
    return (
      emptyFallback ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Select a thread to inspect its Cognee graph.
          </p>
        </div>
      )
    );
  }

  if (result.error) {
    return (
      errorFallback?.(result.error.message) ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">Knowledge graph could not load.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {result.error.message}
          </p>
        </div>
      )
    );
  }

  if (!dims) {
    return <div ref={setContainerEl} className="absolute inset-0" />;
  }

  if (graphData.nodes.length === 0) {
    return (
      emptyFallback ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-muted-foreground max-w-sm">
            No Cognee entities have been captured for this thread yet.
          </p>
        </div>
      )
    );
  }

  const trustCounts = (
    Object.keys(TRUST_LABELS) as KnowledgeGraphTrustState[]
  ).map((state) => ({
    state,
    count: graphData.nodes.filter(
      (node) => knowledgeGraphTrustState(node) === state,
    ).length,
  }));

  return (
    <div ref={setContainerEl} className="absolute inset-0 overflow-hidden">
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        numDimensions={2}
        nodeThreeObject={nodeThreeObject}
        nodeRelSize={6}
        showNavInfo={false}
        linkColor={(link: any) => {
          const matched = matchedIdsRef.current;
          if (!matched) return `${knowledgeGraphTrustColor(link)}cc`;
          const sourceId = endpointId(link.source);
          const targetId = endpointId(link.target);
          return matched.has(sourceId) || matched.has(targetId)
            ? `${knowledgeGraphTrustColor(link)}cc`
            : "rgba(255,255,255,0.12)";
        }}
        linkWidth={(link: any) => (link.evidenceCount > 1 ? 2.5 : 1.8)}
        linkDirectionalArrowLength={() => 4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(link: any) => {
          const matched = matchedIdsRef.current;
          if (!matched) return `${knowledgeGraphTrustColor(link)}cc`;
          const sourceId = endpointId(link.source);
          const targetId = endpointId(link.target);
          return matched.has(sourceId) || matched.has(targetId)
            ? `${knowledgeGraphTrustColor(link)}cc`
            : "rgba(255,255,255,0.12)";
        }}
        linkLabel={(link: any) => link.label || "related to"}
        nodeLabel={(node: any) =>
          `${node.label}${node.typeLabel ? ` (${node.typeLabel})` : ""} - ${TRUST_LABELS[knowledgeGraphTrustState(node)]}${
            node.evidenceCount
              ? ` - ${node.evidenceCount} evidence item${node.evidenceCount === 1 ? "" : "s"}`
              : ""
          }`
        }
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        warmupTicks={50}
        onNodeClick={(node: any) => {
          if (!onNodeClick) return;
          const detail = getNodeWithEdgesRef.current(node.id);
          if (detail) onNodeClick(detail.node, detail.edges);
        }}
        onNodeDragEnd={(node: any) => {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        }}
      />
      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-muted-foreground bg-background/80 rounded px-3 py-1.5 flex-wrap">
        {trustCounts
          .filter((item) => item.count > 0)
          .map((item) => (
            <span key={item.state} className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: TRUST_COLORS[item.state] }}
              />
              {TRUST_LABELS[item.state]} ({item.count})
            </span>
          ))}
      </div>
    </div>
  );
});
