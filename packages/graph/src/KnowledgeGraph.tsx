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
import ForceGraph2D from "react-force-graph-2d";
import { useQuery } from "urql";
import * as d3 from "d3-force";
import { KnowledgeGraphQuery } from "./queries.js";
import {
  carryNodePositions,
  classifyNode,
  composeGraphClassification,
  computeCommunityLayout,
  darkenColor,
  degreeRadius,
  deriveGraphClassification,
  endpointId,
  expandNeighborhood,
  isDarkMode,
  labelsVisibleAtScale,
  wrapLabelLines,
  normalizeGraphSearch,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
  type GraphClassification,
  type GraphEndpoint,
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
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

/** Degree used for sizing — normalized against the graph's max degree at
 *  render time so every view fills the same visual size range. */
function nodeDegree(node: any): number {
  return Math.max(node.relationshipCount ?? 0, node.evidenceCount ?? 0, 1);
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

  const prevGraphRef = useRef<{
    key: string;
    data: { nodes: KnowledgeGraphNode[]; links: KnowledgeGraphEdge[] };
  } | null>(null);
  const graphData = useMemo(() => {
    // Content-keyed identity: identical refetch payloads keep the existing
    // graphData object so the engine never restarts for them.
    const key = JSON.stringify(result.data?.knowledgeGraphGraph ?? null);
    if (prevGraphRef.current && prevGraphRef.current.key === key) {
      return prevGraphRef.current.data;
    }
    const data = buildKnowledgeGraphData(result.data?.knowledgeGraphGraph);
    // Keep simulation positions and user-drag pins stable across refetches.
    carryNodePositions(prevGraphRef.current?.data.nodes ?? null, data.nodes);
    prevGraphRef.current = { key, data };
    return data;
  }, [result.data]);

  // Community layout runs at graphData-identity cadence only — never on
  // filter or focus changes.
  const communityLayout = useMemo(
    () => computeCommunityLayout(graphData.nodes, graphData.links),
    [graphData],
  );

  // Normalize disc sizes to this graph's degree distribution.
  const maxDegree = useMemo(
    () => Math.max(1, ...graphData.nodes.map((n: any) => nodeDegree(n))),
    [graphData],
  );
  const maxDegreeRef = useRef(maxDegree);
  maxDegreeRef.current = maxDegree;

  const nodeRadius = useCallback(
    (node: any) => degreeRadius(nodeDegree(node), maxDegreeRef.current),
    [],
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
  const [labelMode, setLabelMode] = useState<LabelMode>("auto");
  const labelModeRef = useRef<LabelMode>("auto");
  labelModeRef.current = labelMode;
  // Canvas zoom scale from onZoom — the 2D renderer's zoom gate signal.
  const zoomKRef = useRef(1);
  const graphDataRef = useRef(graphData);
  graphDataRef.current = graphData;
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  const nodeLabelVisible = useCallback((nodeId: string) => {
    const mode = labelModeRef.current;
    if (mode === "on") return true;
    if (mode === "off") return false;
    const focusState = focusRef.current;
    if (focusState) return focusState.litIds.has(nodeId);
    return labelsVisibleAtScale(
      zoomKRef.current,
      graphDataRef.current.nodes.length,
    );
  }, []);

  const linkLabelVisible = useCallback((link: any) => {
    // Relationship labels ride the line itself (neo4j style). Off hides
    // them everywhere; in focus they mark the lit set; in the overview
    // they follow the same zoom gate as node labels.
    if (labelModeRef.current === "off") return false;
    const focusState = focusRef.current;
    if (focusState) {
      return (
        focusState.litIds.has(endpointId(link.source)) &&
        focusState.litIds.has(endpointId(link.target))
      );
    }
    if (labelModeRef.current === "on") return true;
    return labelsVisibleAtScale(
      zoomKRef.current,
      graphDataRef.current.nodes.length,
    );
  }, []);

  // Edge brightness follows endpoint lit-state. In focus mode an edge is
  // bright only when BOTH endpoints are lit; search keeps the
  // either-endpoint rule. Reads refs so identity stays inert; repaints
  // ride the classification effect's refresh().
  const isLinkBright = useCallback((link: any) => {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const focusLit = focusRef.current?.litIds;
    if (focusLit) return focusLit.has(sourceId) && focusLit.has(targetId);
    const matched = matchedIdsRef.current;
    if (!matched) return true;
    return matched.has(sourceId) || matched.has(targetId);
  }, []);

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
    edges.sort((a, b) => a.targetLabel.localeCompare(b.targetLabel));
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

  // Canvas painter: flat neo4j-style disc + rim + clipped label, colored
  // by trust state. The neighbor state (1-hop from a search match) keeps
  // the dim fill but draws its ring at full alpha. Reads state through
  // refs; the canvas repaints continuously (autoPauseRedraw false).
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D) => {
      const state = classifyNode(node.id, classificationRef.current);
      const alpha = state === "matched" ? 1 : 0.15;
      const color = knowledgeGraphTrustColor(node);
      const r = nodeRadius(node);

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      if (state === "neighbor") {
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(1.25, r * 0.08);
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      } else {
        ctx.lineWidth = Math.max(0.75, r * 0.05);
        ctx.strokeStyle = darkenColor(color);
        ctx.stroke();
      }

      if (nodeLabelVisible(node.id)) {
        const rawLabel = node.label ?? "";
        // Wrapped white text that stays inside the disc (neo4j style).
        const fontSize = Math.max(3.5, r * 0.32);
        ctx.font = `600 ${fontSize}px sans-serif`;
        const lines = wrapLabelLines(
          (s) => ctx.measureText?.(s)?.width ?? s.length * fontSize * 0.6,
          rawLabel,
          r * 1.7,
          3,
        );
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        const lineHeight = fontSize * 1.15;
        const y0 = node.y - ((lines.length - 1) / 2) * lineHeight;
        lines.forEach((line, index) => {
          ctx.fillText(line, node.x, y0 + index * lineHeight);
        });
      }
      ctx.globalAlpha = 1;
    },
    [nodeLabelVisible, nodeRadius],
  );

  // With a custom nodeCanvasObject the renderer can't infer hit areas —
  // without this, node clicks and drags silently stop working.
  const nodePointerAreaPaint = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius(node) + 4, 0, 2 * Math.PI);
      ctx.fill();
    },
    [nodeRadius],
  );

  // Full link painter (replace mode): line trimmed to disc edges,
  // arrowhead terminating on the target rim, relationship label along
  // lit edges in focus mode. Trust colors carry over from the 3D links.
  // Full link painter (replace mode): the line is trimmed to the disc
  // edges with the arrowhead terminating at the target's rim. When the
  // relationship label is visible it becomes part of the line itself —
  // a gap opens at the midpoint and the text sits inline, in the line's
  // color (neo4j style).
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source;
      const end = link.target;
      if (typeof start !== "object" || typeof end !== "object") return;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (!dist) return;
      const ux = dx / dist;
      const uy = dy / dist;
      const sourceTrim = nodeRadius(start) + 1.5;
      const targetTrim = nodeRadius(end) + 1.5;
      if (dist <= sourceTrim + targetTrim) return;
      const sx = start.x + ux * sourceTrim;
      const sy = start.y + uy * sourceTrim;
      const tx = end.x - ux * targetTrim;
      const ty = end.y - uy * targetTrim;
      const lineLen = dist - sourceTrim - targetTrim;

      const color = isLinkBright(link)
        ? `${knowledgeGraphTrustColor(link)}cc`
        : "rgba(148,163,184,0.15)";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      // Constant 1px screen width regardless of zoom.
      ctx.lineWidth = 1 / globalScale;

      let labeled = false;
      if (linkLabelVisible(link)) {
        const label = link.label || "related to";
        const fontSize = 10 / globalScale;
        ctx.font = `${fontSize}px sans-serif`;
        const textWidth =
          ctx.measureText?.(label)?.width ?? label.length * fontSize * 0.6;
        const gap = textWidth + 10 / globalScale;
        // Only inline the label when the line has room for it, and only
        // when the midpoint is anywhere near the viewport (cheap cull so
        // 10k offscreen labels don't cost a frame).
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        let onScreen = true;
        const t = (ctx as any).getTransform?.();
        const viewport = dimsRef.current;
        if (t && viewport) {
          const px = t.a * mx + t.c * my + t.e;
          const py = t.b * mx + t.d * my + t.f;
          const bound = Math.max(viewport.w, viewport.h) * 2.5;
          onScreen = px > -bound && px < bound && py > -bound && py < bound;
        }
        if (onScreen && lineLen > gap + 14 / globalScale) {
          const half = gap / 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(mx - ux * half, my - uy * half);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(mx + ux * half, my + uy * half);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          let angle = Math.atan2(dy, dx);
          if (angle > Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(angle);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, 0, 0);
          ctx.restore();
          labeled = true;
        }
      }
      if (!labeled) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      // Arrowhead sitting exactly on the target disc's rim.
      const ah = 4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(
        tx - ux * ah - uy * (ah * 0.5),
        ty - uy * ah + ux * (ah * 0.5),
      );
      ctx.lineTo(
        tx - ux * ah + uy * (ah * 0.5),
        ty - uy * ah - ux * (ah * 0.5),
      );
      ctx.closePath();
      ctx.fill();
    },
    [linkLabelVisible, isLinkBright],
  );

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
      ?.strength(nodeCount > 50 ? -120 : -80)
      .distanceMax(200);
    // Community-aware springs: short/strong inside a community, long/weak
    // across bridges, so clusters densify without collapsing together.
    const baseDistance = nodeCount > 50 ? 85 : 65;
    const linkForce = fg.d3Force("link");
    linkForce?.distance((link: any) =>
      sameCommunity(link) ? baseDistance : baseDistance * 2,
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
        .radius((node: any) => nodeRadius(node) + 14)
        .strength(0.9),
    );
    // `dims` is a dep so this re-runs once ForceGraph3D actually mounts —
    // the first pass fires before the container is measured (fg == null).
  }, [graphData, communityLayout, dims]);

  // One-shot framing: zoom to fit after the first simulation settle.
  // Zoom/pan after that belongs to the user.
  const zoomInitRef = useRef(false);
  // The first paint happens at the default zoom for a frame before
  // onEngineStop applies the fit — keep the canvas invisible until the
  // framing has landed so there's no visible jump.
  const [framed, setFramed] = useState(false);

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
    <div
      ref={setContainerEl}
      className={`absolute inset-0 overflow-hidden transition-opacity duration-150 ${
        framed ? "opacity-100" : "opacity-0"
      }`}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        // Continuous repaint so ref-driven focus/filter/zoom changes show
        // without rebuilding graphData.
        autoPauseRedraw={false}
        linkLabel={(link: any) => link.label || "related to"}
        linkCanvasObjectMode={() => "replace" as const}
        linkCanvasObject={linkCanvasObject}
        nodeLabel={(node: any) =>
          `${node.label}${node.typeLabel ? ` (${node.typeLabel})` : ""} - ${TRUST_LABELS[knowledgeGraphTrustState(node)]}${
            node.evidenceCount
              ? ` - ${node.evidenceCount} evidence item${node.evidenceCount === 1 ? "" : "s"}`
              : ""
          }`
        }
        // Settle the layout synchronously before the first paint: zero
        // cooldown until the initial framing lands (no load animation),
        // then normal cooldown so dragging a node relaxes its neighbors.
        cooldownTicks={framed ? 120 : 0}
        // Warmup runs at slow decay so the pre-paint settle converges
        // fully (communities separate); once framed, fast decay keeps
        // drag-triggered reheats snappy.
        d3AlphaDecay={
          framed ? 0.05 : graphData.nodes.length > 2000 ? 0.035 : 0.0115
        }
        d3VelocityDecay={0.55}
        warmupTicks={graphData.nodes.length > 2000 ? 200 : 600}
        onZoom={({ k }: { k: number }) => {
          zoomKRef.current = k;
        }}
        onEngineStop={() => {
          if (zoomInitRef.current) return;
          zoomInitRef.current = true;
          // Frame the graph, but never fit-to-tiny: sparse layouts
          // (many small components) would otherwise open unreadably
          // zoomed out.
          fgRef.current?.zoomToFit?.(0, 40);
          const k = fgRef.current?.zoom?.();
          if (typeof k === "number" && k < 0.55) {
            fgRef.current?.zoom?.(0.55, 0);
          }
          setFramed(true);
        }}
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
        }}
      />
      {focus && selectedNode && (
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
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
        labelMode={labelMode}
        onLabelModeChange={setLabelMode}
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
