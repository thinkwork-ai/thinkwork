/**
 * KnowledgeGraph — 3D force-graph rendering Graph-extracted thread entities.
 *
 * This intentionally follows WikiGraph's force-graph discipline: graphData
 * changes only when the server graph changes, while search/status filters
 * mutate material opacity in place. That keeps the d3 simulation and camera
 * stable while operators inspect weak or diagnostic graph output.
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
  carryNodePositions,
  classifyNode,
  composeGraphClassification,
  computeCommunityLayout,
  deriveGraphClassification,
  endpointId,
  expandNeighborhood,
  initialCameraZ,
  FLAT_CAMERA_FOV,
  labelsVisibleAtZoom,
  normalizeGraphSearch,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
  type GraphClassification,
  type GraphEndpoint,
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
import { makeEdgeLabelSprite } from "./three-label-sprite.js";
import { GraphLabelToggles } from "./GraphLabelToggles.js";

export type KnowledgeGraphGroundingStatus =
  "GROUNDED" | "UNAPPROVED_TYPE" | "UNGROUNDED" | "CONFLICT" | "UNKNOWN";

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
  runId?: string | null;
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

/** Node radius by degree — shared by rendering and the collide force so
 *  discs can never be forced to overlap. */
function knowledgeNodeRadius(node: any): number {
  const degree = Math.max(
    node.relationshipCount ?? 0,
    node.evidenceCount ?? 0,
    1,
  );
  return Math.max(8, Math.min(24, 8 + Math.sqrt(degree) * 2));
}

export const KnowledgeGraph = forwardRef<
  KnowledgeGraphHandle,
  KnowledgeGraphProps
>(function KnowledgeGraph(
  {
    tenantId,
    threadId,
    runId,
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
    variables: { tenantId, threadId, runId: runId ?? null },
    pause: !tenantId,
  });

  const prevNodesRef = useRef<KnowledgeGraphNode[] | null>(null);
  const graphData = useMemo(() => {
    const data = buildKnowledgeGraphData(result.data?.knowledgeGraphGraph);
    // Keep simulation positions and user-drag pins stable across refetches.
    carryNodePositions(prevNodesRef.current, data.nodes);
    prevNodesRef.current = data.nodes;
    return data;
  }, [result.data]);

  // Community layout runs at graphData-identity cadence only — never on
  // filter or focus changes.
  const communityLayout = useMemo(
    () => computeCommunityLayout(graphData.nodes, graphData.links),
    [graphData],
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

  const searchClassification = useMemo<GraphClassification | null>(
    () => deriveGraphClassification(matchedIds, graphData.links),
    [matchedIds, graphData.links],
  );

  // Graph Focus Mode: clicking a node lights its neighborhood in place
  // while everything else dims. Focus supersedes search while active; the
  // search classification is restored untouched on exit. Focus changes
  // flow through the same opacity-mutation path as search — no graphData
  // rebuild, no force re-registration.
  const [focus, setFocus] = useState<GraphFocusState | null>(null);
  const focusRef = useRef<GraphFocusState | null>(null);
  focusRef.current = focus;

  // The focused node renders as an overlay chip instead of immediately
  // opening the host detail sheet — clicking a node should not shift the
  // layout mid-exploration. Clicking the chip opens the sheet.
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(
    null,
  );

  const exitFocus = useCallback(() => {
    setFocus(null);
    setSelectedNode(null);
  }, []);

  const classification = useMemo<GraphClassification | null>(
    () => composeGraphClassification(searchClassification, focus),
    [searchClassification, focus],
  );
  const classificationRef = useRef<GraphClassification | null>(null);
  classificationRef.current = classification;

  const matchedIdsRef = useRef<Set<string> | null>(null);
  matchedIdsRef.current = matchedIds;

  const focusNode = useCallback(
    (nodeId: string) => {
      const expansion = expandNeighborhood(
        [nodeId],
        graphData.links,
        DEFAULT_FOCUS_DEGREE,
        DEFAULT_FOCUS_CAP,
      );
      setFocus({
        focusedId: nodeId,
        litIds: expansion.ids,
        degreeUsed: expansion.degreeUsed,
        truncated: expansion.truncated,
      });
    },
    [graphData],
  );

  // Escape exits focus. Skip events a dialog/sheet already consumed so
  // closing an open detail sheet doesn't also tear down focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (focusRef.current) exitFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitFocus]);

  // Label visibility: `auto` follows the zoom gate in the overview and
  // lights lit-set labels in focus; `on`/`off` override absolutely.
  const [nodeLabelMode, setNodeLabelMode] = useState<LabelMode>("auto");
  const [linkLabelMode, setLinkLabelMode] = useState<LabelMode>("auto");
  const nodeLabelModeRef = useRef<LabelMode>("auto");
  nodeLabelModeRef.current = nodeLabelMode;
  const linkLabelModeRef = useRef<LabelMode>("auto");
  linkLabelModeRef.current = linkLabelMode;
  const labelGateRef = useRef(true);
  const graphDataRef = useRef(graphData);
  graphDataRef.current = graphData;

  const nodeLabelVisible = useCallback((nodeId: string) => {
    const mode = nodeLabelModeRef.current;
    if (mode === "on") return true;
    if (mode === "off") return false;
    const focusState = focusRef.current;
    if (focusState) return focusState.litIds.has(nodeId);
    return labelGateRef.current;
  }, []);

  const linkLabelVisible = useCallback((link: any) => {
    const mode = linkLabelModeRef.current;
    if (mode === "off") return false;
    const focusState = focusRef.current;
    if (focusState) {
      return (
        focusState.litIds.has(endpointId(link.source)) &&
        focusState.litIds.has(endpointId(link.target))
      );
    }
    return mode === "on" ? labelGateRef.current : false;
  }, []);

  // Mutates stashed sprite visibility in place — same no-restart
  // discipline as the opacity effect.
  const applyLabelVisibility = useCallback(() => {
    for (const n of graphDataRef.current.nodes as any[]) {
      if (n.__labelSprite) n.__labelSprite.visible = nodeLabelVisible(n.id);
    }
    for (const l of graphDataRef.current.links as any[]) {
      if (l.__labelSprite) l.__labelSprite.visible = linkLabelVisible(l);
    }
  }, [nodeLabelVisible, linkLabelVisible]);

  // Mode changes reapply visibility and refresh() so the link object
  // accessor re-runs (edge-label sprites created/dropped to match).
  const labelModesInitRef = useRef(false);
  useEffect(() => {
    if (!labelModesInitRef.current) {
      labelModesInitRef.current = true;
      return;
    }
    applyLabelVisibility();
    fgRef.current?.refresh?.();
  }, [nodeLabelMode, linkLabelMode, applyLabelVisibility]);

  // Zoom gate: 3D mode has no onZoom event, so listen (throttled) on the
  // controls' change event and read the camera distance.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !dims) return;
    const controls = fg.controls?.();
    const nodeCount = graphDataRef.current.nodes.length;
    labelGateRef.current = labelsVisibleAtZoom(
      // Falls back to the initial framing distance when this runs before
      // camera init (z still 0).
      fg.camera?.()?.position?.z || initialCameraZ(nodeCount),
      nodeCount,
    );
    applyLabelVisibility();
    if (!controls?.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const count = graphDataRef.current.nodes.length;
        const gate = labelsVisibleAtZoom(fg.camera().position.z, count);
        if (gate !== labelGateRef.current) {
          labelGateRef.current = gate;
          applyLabelVisibility();
        }
      }, 150);
    };
    controls.addEventListener("change", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      controls.removeEventListener("change", onChange);
    };
  }, [dims, graphData, applyLabelVisibility]);

  // Edge brightness follows endpoint lit-state. In focus mode an edge is
  // bright only when BOTH endpoints are lit; search keeps the
  // either-endpoint rule. Reads refs so identity stays inert; repaints
  // ride the classification effect's refresh().
  const isLinkBright = (link: any) => {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const focusLit = focusRef.current?.litIds;
    if (focusLit) return focusLit.has(sourceId) && focusLit.has(targetId);
    const matched = matchedIdsRef.current;
    if (!matched) return true;
    return matched.has(sourceId) || matched.has(targetId);
  };

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

  const nodeThreeObject = useCallback(
    (node: any) => {
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
      const r = knowledgeNodeRadius(node);
      const sphereOp = state === "matched" ? 1 : 0.15;
      const ringOp = state === "neighbor" ? 1 : 0;

      const group = new THREE.Group();

      // Flat neo4j-style disc: unlit fill + darker rim. The camera looks
      // straight down +z, so a CircleGeometry needs no billboarding.
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: sphereOp,
      });
      group.add(new THREE.Mesh(new THREE.CircleGeometry(r, 48), material));
      const rimMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(0.55),
        transparent: true,
        opacity: sphereOp,
      });
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.9, r, 48),
        rimMaterial,
      );
      rim.position.z = 0.5;
      group.add(rim);

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
      sprite.position.set(0, 0, 2);
      sprite.visible = nodeLabelVisible(node.id);
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
      ringSprite.position.set(0, 0, 1);
      group.add(ringSprite);

      node.__sphereMat = material;
      node.__rimMat = rimMaterial;
      node.__spriteMat = spriteMaterial;
      node.__ringMat = ringMaterial;
      node.__labelSprite = sprite;

      return group;
    },
    [nodeLabelVisible],
  );

  useEffect(() => {
    for (const node of graphData.nodes as any[]) {
      const state = classifyNode(node.id, classification);
      const opacity = state === "matched" ? 1 : 0.15;
      const ringOpacity = state === "neighbor" ? 1 : 0;
      if (node.__sphereMat) node.__sphereMat.opacity = opacity;
      if (node.__rimMat) node.__rimMat.opacity = opacity;
      if (node.__spriteMat) node.__spriteMat.opacity = opacity;
      if (node.__ringMat) node.__ringMat.opacity = ringOpacity;
    }
    // Focus flips which labels are lit; refresh() also re-runs the link
    // object accessor so lit edges gain/drop their label sprites.
    applyLabelVisibility();
    fgRef.current?.refresh?.();
  }, [classification, graphData.nodes, applyLabelVisibility]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const nodeCount = graphData.nodes.length;
    const { communityByNode, anchors } = communityLayout;
    const anchorFor = (node: any) =>
      anchors.get(communityByNode.get(node.id) ?? -1) ?? { x: 0, y: 0 };
    const sameCommunity = (link: any) => {
      const s = communityByNode.get(endpointId(link.source));
      const t = communityByNode.get(endpointId(link.target));
      return s !== undefined && s === t;
    };

    fg.d3Force("charge")
      ?.strength(nodeCount > 50 ? -200 : -130)
      .distanceMax(200);
    // Community-aware springs: short/strong inside a community, long/weak
    // across bridges, so clusters densify without collapsing together.
    const baseDistance = nodeCount > 50 ? 100 : 75;
    const linkForce = fg.d3Force("link");
    linkForce?.distance((link: any) =>
      sameCommunity(link) ? baseDistance * 0.7 : baseDistance * 1.8,
    );
    linkForce?.strength?.((link: any) => (sameCommunity(link) ? 0.6 : 0.05));
    // Per-community anchors replace the global center force — anchors are
    // packed around the origin so the graph stays framed. Unassigned nodes
    // (defensive) fall back to center attraction.
    fg.d3Force("center", null);
    fg.d3Force("x", d3.forceX((node: any) => anchorFor(node).x).strength(0.08));
    fg.d3Force("y", d3.forceY((node: any) => anchorFor(node).y).strength(0.08));
    fg.d3Force(
      "collide",
      d3
        .forceCollide()
        .radius((node: any) => knowledgeNodeRadius(node) + 6)
        .strength(0.9),
    );
    // `dims` is a dep so this re-runs once ForceGraph3D actually mounts —
    // the first pass fires before the container is measured (fg == null).
  }, [graphData, communityLayout, dims]);

  const cameraInitRef = useRef(false);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !dims || cameraInitRef.current) return;
    const camera = fg.camera();
    const controls = fg.controls();
    const initialZ = initialCameraZ(graphData.nodes.length);
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
    // Near-orthographic: a narrow FOV kills the perspective skew that
    // made the 2D layout read as 3D. initialCameraZ compensates.
    camera.fov = FLAT_CAMERA_FOV;
    camera.updateProjectionMatrix?.();
    cameraInitRef.current = true;
  }, [dims, graphData]);

  const anyFetching = result.fetching && !result.data;
  if (anyFetching) {
    return (
      loadingFallback ?? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          Loading graph...
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
            No known ontology entities have been captured yet.
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
        linkColor={(link: any) =>
          isLinkBright(link)
            ? `${knowledgeGraphTrustColor(link)}cc`
            : "rgba(255,255,255,0.12)"
        }
        linkWidth={1.2}
        linkLabel={(link: any) => link.label || "related to"}
        linkThreeObjectExtend={true}
        linkThreeObject={(link: any) => {
          // Persistent edge-label sprites exist only where they can show:
          // the focused lit set (auto) or the zoom-gated overview (mode
          // "on"). Everything else returns nothing — at 10k+ nodes,
          // sprite-per-edge is the perf cliff.
          const mode = linkLabelModeRef.current;
          const focusState = focusRef.current;
          const lit =
            !!focusState &&
            focusState.litIds.has(endpointId(link.source)) &&
            focusState.litIds.has(endpointId(link.target));
          if (mode === "off" || (!lit && mode !== "on")) {
            link.__labelSprite = undefined;
            return undefined as unknown as THREE.Object3D;
          }
          const sprite = makeEdgeLabelSprite(link.label || "related to");
          sprite.visible = linkLabelVisible(link);
          link.__labelSprite = sprite;
          return sprite;
        }}
        linkPositionUpdate={(obj: any, coords: any) => {
          if (!obj) return false;
          const { start, end } = coords;
          // Align the label with its line (neo4j-style), flipped to stay
          // upright, and nudged just above the line along its normal.
          let angle = Math.atan2(end.y - start.y, end.x - start.x);
          if (angle > Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;
          obj.position.set(
            (start.x + end.x) / 2 - Math.sin(angle) * 8,
            (start.y + end.y) / 2 + Math.cos(angle) * 8,
            ((start.z ?? 0) + (end.z ?? 0)) / 2,
          );
          if (obj.material) obj.material.rotation = angle;
          return false;
        }}
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
          // Clicking a node focuses it and surfaces the selected-node
          // chip — the detail sheet opens only from the chip, so the
          // layout never shifts mid-exploration.
          focusNode(node.id);
          setSelectedNode(node as KnowledgeGraphNode);
        }}
        onBackgroundClick={() => {
          if (focusRef.current) exitFocus();
        }}
        onNodeDragEnd={(node: any) => {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        }}
      />
      {focus && selectedNode && (
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          <button
            type="button"
            aria-label={`Open details for ${selectedNode.label}`}
            className="flex items-center gap-2 text-xs bg-background/90 border border-border rounded-full px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              if (!onNodeClick) return;
              const detail = getNodeWithEdgesRef.current(selectedNode.id);
              if (detail) onNodeClick(detail.node, detail.edges);
            }}
          >
            <span className="font-medium">{selectedNode.label}</span>
            <span className="text-muted-foreground">View details</span>
          </button>
          {focus.truncated && (
            <div
              role="status"
              className="text-[11px] text-muted-foreground bg-background/80 rounded px-3 py-1.5"
            >
              Showing direct connections only
            </div>
          )}
        </div>
      )}
      <GraphLabelToggles
        nodeLabelMode={nodeLabelMode}
        linkLabelMode={linkLabelMode}
        onNodeLabelModeChange={setNodeLabelMode}
        onLinkLabelModeChange={setLinkLabelMode}
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
