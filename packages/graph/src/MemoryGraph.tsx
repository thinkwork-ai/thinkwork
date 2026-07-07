/**
 * MemoryGraph — 3D force-graph rendering Hindsight memories + entities.
 *
 * Performance patterns (in-place opacity mute on filter, one-shot camera
 * init, stable nodeThreeObject) are load-bearing — each one exists to
 * avoid a camera reset or simulation restart on filter-keystrokes. Do
 * not "clean up" those without measuring.
 *
 * Ported out of the app layer during the Memory UI work so web surfaces share
 * one graph implementation.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useQuery, useClient } from "urql";
import * as d3 from "d3-force";
import { MemoryGraphQuery } from "./queries.js";
import {
  carryNodePositions,
  classifyNode,
  composeGraphClassification,
  computeCommunityLayout,
  darkenColor,
  endpointId,
  expandNeighborhood,
  labelsVisibleAtScale,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
  type GraphClassification,
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
import { GraphLabelToggles } from "./GraphLabelToggles.js";
import {
  MEMORY_COLOR,
  ENTITY_COLOR,
  MEMORY_TYPE_COLORS,
} from "./palettes/memory-palette.js";

export interface MemoryGraphNode {
  id: string;
  label: string;
  nodeType: string;
  strategy: string | null;
  entityType: string | null;
  edgeCount: number;
  latestThreadId: string | null;
}

export interface MemoryGraphHandle {
  refetch: () => void;
  getNodeWithEdges: (nodeId: string) => {
    node: MemoryGraphNode;
    edges: {
      label: string;
      targetLabel: string;
      targetType: string;
      targetId: string;
    }[];
  } | null;
}

interface MemoryGraphProps {
  userId?: string;
  userIds?: string[];
  /** @deprecated Use userId. */
  agentId?: string;
  /** @deprecated Use userIds. */
  agentIds?: string[];
  agentNames?: Record<string, string>;
  useRequesterScope?: boolean;
  onNodeClick?: (
    node: MemoryGraphNode,
    connectedEdges: {
      label: string;
      targetLabel: string;
      targetType: string;
      targetId: string;
    }[],
  ) => void;
  onTypesLoaded?: (types: string[]) => void;
  typeFilter?: string[];
  searchQuery?: string;
  hideFiltered?: boolean;
  /** Optional render slot for the loading state. */
  loadingFallback?: React.ReactNode;
  /** Optional render slot for the empty state. */
  emptyFallback?: React.ReactNode;
}

/** Node radius by degree — shared by rendering and the collide force so
 *  discs can never be forced to overlap. */
function memoryNodeRadius(node: any): number {
  if (node.nodeType === "memory") return 12;
  const mentions = node.edgeCount || 1;
  return Math.max(8, Math.min(24, 8 + Math.sqrt(mentions) * 2));
}

export const MemoryGraph = forwardRef<MemoryGraphHandle, MemoryGraphProps>(
  function MemoryGraph(
    {
      userId,
      userIds,
      agentId,
      agentIds,
      agentNames,
      useRequesterScope = false,
      onNodeClick,
      onTypesLoaded,
      typeFilter,
      searchQuery,
      hideFiltered: _hideFiltered = false,
      loadingFallback,
      emptyFallback,
    },
    ref,
  ) {
    // Callback ref: re-measures whenever the mounted DOM element changes.
    // A plain useRef + empty-deps effect misses the case where the
    // "Loading graph..." branch mounts first (no ref attached), then swaps
    // to the main branch once the query resolves — dims would stay null
    // forever and strand the component on the "!dims" blank branch.
    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
    const fgRef = useRef<any>(null);
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

    const effectiveUserIds = userIds ?? agentIds;
    const effectiveUserId =
      userId ??
      agentId ??
      (effectiveUserIds?.length === 1 ? effectiveUserIds[0] : undefined);
    const isMultiAgent = !!effectiveUserIds && effectiveUserIds.length > 1;
    const client = useClient();

    // Single-agent query (only when not multi-agent)
    const [singleResult, singleReexecute] = useQuery({
      query: MemoryGraphQuery,
      variables: { userId: effectiveUserId ?? null },
      pause: isMultiAgent || (!effectiveUserId && !useRequesterScope),
    });

    // Multi-agent: fetch all graphs manually
    const [multiResults, setMultiResults] = useState<Record<string, any>>({});
    const [multiFetching, setMultiFetching] = useState(false);

    const fetchAllAgents = useCallback(async () => {
      if (!effectiveUserIds || effectiveUserIds.length === 0) {
        setMultiFetching(false);
        return;
      }
      setMultiFetching(true);
      try {
        const results: Record<string, any> = {};
        await Promise.all(
          effectiveUserIds.map(async (id) => {
            try {
              const res = await client
                .query(MemoryGraphQuery, { userId: id })
                .toPromise();
              results[id] = res.data?.memoryGraph;
            } catch {
              results[id] = { nodes: [], edges: [] };
            }
          }),
        );
        setMultiResults(results);
      } catch {
        // Fallback to empty
      } finally {
        setMultiFetching(false);
      }
    }, [effectiveUserIds, client]);

    useEffect(() => {
      if (isMultiAgent) fetchAllAgents();
    }, [isMultiAgent, fetchAllAgents]);

    const getNodeWithEdgesRef = useRef<MemoryGraphHandle["getNodeWithEdges"]>(
      () => null,
    );

    useImperativeHandle(ref, () => ({
      refetch: () => {
        if (isMultiAgent) fetchAllAgents();
        else singleReexecute({ requestPolicy: "network-only" });
      },
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

    // Build all nodes from all agents, adding agent hub nodes in multi-agent mode
    const allNodes = useMemo(() => {
      const nodes: MemoryGraphNode[] = [];
      if (isMultiAgent) {
        for (const [aid, graph] of Object.entries(multiResults)) {
          if (!graph) continue;
          for (const n of (graph as any).nodes ?? []) {
            nodes.push({
              id: `${aid}:${n.id}`,
              label: n.label ?? n.id,
              nodeType: n.type as string,
              strategy: n.strategy ?? null,
              entityType: n.entityType ?? null,
              edgeCount: n.edgeCount ?? 0,
              latestThreadId: n.latestThreadId ?? null,
            });
          }
        }
        // Agent hub nodes removed — entities only
      } else {
        const graph = singleResult.data?.memoryGraph;
        if (graph) {
          for (const n of graph.nodes ?? []) {
            nodes.push({
              id: n.id,
              label: n.label ?? n.id,
              nodeType: n.type as string,
              strategy: n.strategy ?? null,
              entityType: n.entityType ?? null,
              edgeCount: n.edgeCount ?? 0,
              latestThreadId: n.latestThreadId ?? null,
            });
          }
        }
      }
      return nodes;
    }, [
      isMultiAgent,
      multiResults,
      singleResult.data,
      effectiveUserIds,
      agentNames,
    ]);

    // Report unique entity types to parent (only when types actually change)
    const prevTypesRef = useRef<string>("");
    useEffect(() => {
      if (!onTypesLoaded || allNodes.length === 0) return;
      const types = new Set<string>();
      for (const n of allNodes) {
        if (n.nodeType === "memory") types.add("Memory");
        else if (n.entityType)
          types.add(
            n.entityType.charAt(0).toUpperCase() + n.entityType.slice(1),
          );
      }
      const sorted = Array.from(types).sort();
      const key = sorted.join(",");
      if (key !== prevTypesRef.current) {
        prevTypesRef.current = key;
        onTypesLoaded(sorted);
      }
    }, [allNodes, onTypesLoaded]);

    // Determine which nodes match filters
    const hasFilter = (typeFilter && typeFilter.length > 0) || !!searchQuery;

    const matchedIds = useMemo(() => {
      if (!hasFilter) return null; // null = no filter active, all match
      let filtered = allNodes;
      if (typeFilter && typeFilter.length > 0) {
        const filterSet = new Set(typeFilter);
        filtered = filtered.filter((n) => {
          if (n.nodeType === "agent") return filterSet.has("Agent");
          if (n.nodeType === "memory") return filterSet.has("Memory");
          const et = n.entityType
            ? n.entityType.charAt(0).toUpperCase() + n.entityType.slice(1)
            : "";
          return filterSet.has(et);
        });
      }
      if (searchQuery) {
        const normalize = (s: string) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const q = normalize(searchQuery);
        filtered = filtered.filter((n) => normalize(n.label).includes(q));
      }
      return new Set(filtered.map((n) => n.id));
    }, [allNodes, typeFilter, searchQuery, hasFilter]);

    // Build graph data from raw sources only — filter state is NOT a dep.
    // Mute/highlight on filter changes is applied by mutating material
    // opacity in-place (see effect below), not by rebuilding graphData.
    // Rebuilding would give ForceGraph3D a new identity → restart the
    // simulation and reset the camera on every keystroke.
    const prevNodesRef = useRef<MemoryGraphNode[] | null>(null);
    const graphData = useMemo(() => {
      const nodeIds = new Set(allNodes.map((n) => n.id));
      const links: {
        source: string;
        target: string;
        label: string;
        weight: number;
      }[] = [];
      if (isMultiAgent) {
        for (const [aid, graph] of Object.entries(multiResults)) {
          if (!graph) continue;
          for (const e of (graph as any).edges ?? []) {
            const src = `${aid}:${e.source}`;
            const tgt = `${aid}:${e.target}`;
            if (nodeIds.has(src) && nodeIds.has(tgt)) {
              links.push({
                source: src,
                target: tgt,
                label: e.label ?? "",
                weight: e.weight ?? 0.5,
              });
            }
          }
        }
      } else {
        const graph = singleResult.data?.memoryGraph;
        if (graph) {
          for (const e of graph.edges ?? []) {
            if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
              links.push({
                source: e.source,
                target: e.target,
                label: e.label ?? "",
                weight: e.weight ?? 0.5,
              });
            }
          }
        }
      }
      // Keep simulation positions and user-drag pins stable across
      // refetches — fresh node objects would otherwise scatter the layout.
      carryNodePositions(prevNodesRef.current, allNodes);
      prevNodesRef.current = allNodes;
      return { nodes: allNodes, links };
    }, [allNodes, isMultiAgent, multiResults, singleResult.data]);

    // Community layout runs at graphData-identity cadence only — never on
    // filter or focus changes.
    const communityLayout = useMemo(
      () => computeCommunityLayout(graphData.nodes, graphData.links),
      [graphData],
    );

    // Ref so nodeThreeObject (stable callback) can read the current filter
    // without being re-created each time matchedIds changes.
    const matchedIdsRef = useRef<Set<string> | null>(null);
    matchedIdsRef.current = matchedIds;

    // MemoryGraph search has no neighbor-ring affordance — matched nodes
    // light, the rest dim.
    const searchClassification = useMemo<GraphClassification | null>(
      () =>
        matchedIds ? { matchedIds, neighborIds: new Set<string>() } : null,
      [matchedIds],
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
    const [selectedNode, setSelectedNode] = useState<MemoryGraphNode | null>(
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
    // Canvas zoom scale from onZoom — the 2D renderer's zoom gate signal.
    const zoomKRef = useRef(1);
    const graphDataRef = useRef(graphData);
    graphDataRef.current = graphData;

    const nodeLabelVisible = useCallback((nodeId: string) => {
      const mode = nodeLabelModeRef.current;
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
      // Relationship labels exist only in focus mode — at overview scale
      // they float mid-air along long bridge edges as pure noise. The
      // toggle governs the focused lit set: auto/on show, off hides.
      if (linkLabelModeRef.current === "off") return false;
      const focusState = focusRef.current;
      if (!focusState) return false;
      return (
        focusState.litIds.has(endpointId(link.source)) &&
        focusState.litIds.has(endpointId(link.target))
      );
    }, []);

    // Edge brightness follows endpoint lit-state. In focus mode an edge is
    // bright only when BOTH endpoints are lit; search keeps the
    // either-endpoint rule. Reads refs so identity stays inert.
    const isLinkBright = useCallback((link: any) => {
      const sId = endpointId(link.source);
      const tId = endpointId(link.target);
      const focusLit = focusRef.current?.litIds;
      if (focusLit) return focusLit.has(sId) && focusLit.has(tId);
      const m = matchedIdsRef.current;
      if (!m) return true;
      return m.has(sId) || m.has(tId);
    }, []);

    // Update getNodeWithEdges ref after graphData is available
    getNodeWithEdgesRef.current = (nodeId: string) => {
      const node = graphData.nodes.find((n: any) => n.id === nodeId);
      if (!node) return null;
      const edges = graphData.links
        .filter((l: any) => {
          const sId = typeof l.source === "object" ? l.source.id : l.source;
          const tId = typeof l.target === "object" ? l.target.id : l.target;
          return sId === nodeId || tId === nodeId;
        })
        .map((l: any) => {
          const sId = typeof l.source === "object" ? l.source.id : l.source;
          const tId = typeof l.target === "object" ? l.target.id : l.target;
          const otherId = sId === nodeId ? tId : sId;
          const otherNode = graphData.nodes.find((n: any) => n.id === otherId);
          return {
            label: l.label || "MENTIONS",
            targetLabel: otherNode?.label ?? otherId,
            targetType: otherNode?.nodeType ?? "unknown",
            targetId: otherId,
          };
        });
      return { node: node as MemoryGraphNode, edges };
    };

    // Canvas painter: flat neo4j-style disc + rim + centered label. Reads
    // classification/focus/label state through refs so its identity stays
    // stable; the canvas repaints continuously (autoPauseRedraw=false), so
    // filter and focus changes show without touching graphData or forces.
    const nodeCanvasObject = useCallback(
      (node: any, ctx: CanvasRenderingContext2D) => {
        const state = classifyNode(node.id, classificationRef.current);
        const alpha = state === "matched" ? 1 : 0.15;
        const isMemory = node.nodeType === "memory";
        const entityType = node.entityType as string | null;
        const color = isMemory
          ? MEMORY_COLOR
          : entityType
            ? MEMORY_TYPE_COLORS[entityType] || ENTITY_COLOR
            : ENTITY_COLOR;
        const r = memoryNodeRadius(node);

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(1.25, r * 0.1);
        ctx.strokeStyle = darkenColor(color);
        ctx.stroke();

        if (nodeLabelVisible(node.id)) {
          const label = isMemory
            ? "Memory"
            : entityType
              ? entityType.charAt(0).toUpperCase() + entityType.slice(1)
              : node.label?.slice(0, 12) || "Entity";
          ctx.font = `600 ${Math.max(4, r * 0.42)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, node.x, node.y);
        }
        ctx.globalAlpha = 1;
      },
      [nodeLabelVisible],
    );

    // With a custom nodeCanvasObject the renderer can't infer hit areas —
    // without this, node clicks and drags silently stop working (the
    // exact regression that sank previous 2D attempts).
    const nodePointerAreaPaint = useCallback(
      (node: any, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, memoryNodeRadius(node) + 4, 0, 2 * Math.PI);
        ctx.fill();
      },
      [],
    );

    // Full link painter (replace mode): the line is trimmed to the disc
    // edges with the arrowhead terminating at the target's rim — lines
    // never run under translucent discs. Relationship labels draw along
    // lit edges (focus mode only), constant on-screen size, upright.
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
        const sourceTrim = memoryNodeRadius(start) + 1.5;
        const targetTrim = memoryNodeRadius(end) + 1.5;
        if (dist <= sourceTrim + targetTrim) return; // discs touch
        const sx = start.x + ux * sourceTrim;
        const sy = start.y + uy * sourceTrim;
        const tx = end.x - ux * targetTrim;
        const ty = end.y - uy * targetTrim;

        const color = isLinkBright(link)
          ? "rgba(148,163,184,0.9)"
          : "rgba(148,163,184,0.12)";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Arrowhead sitting exactly on the target disc's rim.
        const ah = 5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ux * ah - uy * (ah * 0.5), ty - uy * ah + ux * (ah * 0.5));
        ctx.lineTo(tx - ux * ah + uy * (ah * 0.5), ty - uy * ah - ux * (ah * 0.5));
        ctx.closePath();
        ctx.fill();

        if (linkLabelVisible(link)) {
          let angle = Math.atan2(dy, dx);
          if (angle > Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate((sx + tx) / 2, (sy + ty) / 2);
          ctx.rotate(angle);
          ctx.font = `${11 / globalScale}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(226,232,240,0.9)";
          ctx.fillText(link.label || "mentions", 0, -2 / globalScale);
          ctx.restore();
        }
      },
      [linkLabelVisible, isLinkBright],
    );

    // Force layout tuning — safe to re-run when data changes (strengths
    // scale with node count). Does NOT touch the camera, so filter updates
    // no longer reset the user's zoom/pan.
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

      const chargeStrength = nodeCount > 50 ? -120 : -80;
      fg.d3Force("charge")?.strength(chargeStrength).distanceMax(200);
      // Community-aware springs: short/strong inside a community, long/weak
      // across bridges, so clusters densify without collapsing together.
      const baseDistance = nodeCount > 50 ? 70 : 55;
      const linkForce = fg.d3Force("link");
      linkForce?.distance((link: any) =>
        sameCommunity(link) ? baseDistance : baseDistance * 2,
      );
      linkForce?.strength?.((link: any) => (sameCommunity(link) ? 0.6 : 0.05));
      // Per-community anchors replace the global center force — anchors
      // are packed around the origin so the graph stays framed. Unassigned
      // nodes (defensive) fall back to center attraction.
      fg.d3Force("center", null);
      fg.d3Force(
        "x",
        d3.forceX((node: any) => anchorFor(node).x).strength(0.08),
      );
      fg.d3Force(
        "y",
        d3.forceY((node: any) => anchorFor(node).y).strength(0.08),
      );
      fg.d3Force(
        "collide",
        d3
          .forceCollide()
          .radius((node: any) => memoryNodeRadius(node) + 12)
          .strength(0.9),
      );
      // `dims` is a dep so this re-runs once ForceGraph3D actually mounts —
      // the first pass fires before the container is measured (fg == null).
    }, [graphData, communityLayout, dims]);

    // One-shot framing: zoom to fit after the first simulation settle.
    // Zoom/pan after that belongs to the user.
    const zoomInitRef = useRef(false);

    const anyFetching = isMultiAgent
      ? multiFetching
      : singleResult.fetching && !singleResult.data;
    if (anyFetching) {
      return (
        loadingFallback ?? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            Loading graph...
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
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No knowledge graph yet. Click Dream to build one from agent
              memories.
            </p>
          </div>
        )
      );
    }

    return (
      <div ref={setContainerEl} className="absolute inset-0 overflow-hidden">
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dims.w}
          height={dims.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
          // Continuous repaint so ref-driven focus/filter/zoom changes show
          // without rebuilding graphData (the 2D analog of the old
          // material-mutation + refresh pattern).
          autoPauseRedraw={false}
          linkLabel={(link: any) => link.label || "mentions"}
          linkCanvasObjectMode={() => "replace" as const}
          linkCanvasObject={linkCanvasObject}
          nodeLabel={(node: any) =>
            `${node.label}${node.entityType ? ` (${node.entityType})` : ""}${
              node.edgeCount ? ` — ${node.edgeCount} mentions` : ""
            }`
          }
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={50}
          onZoom={({ k }: { k: number }) => {
            zoomKRef.current = k;
          }}
          onEngineStop={() => {
            if (zoomInitRef.current) return;
            zoomInitRef.current = true;
            fgRef.current?.zoomToFit?.(400, 40);
          }}
          onNodeClick={(node: any) => {
            // Clicking a node focuses it and surfaces the selected-node
            // chip — the detail sheet opens only from the chip, so the
            // layout never shifts mid-exploration.
            focusNode(node.id);
            setSelectedNode(node as MemoryGraphNode);
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
          {Object.entries(MEMORY_TYPE_COLORS)
            .filter(([k]) =>
              graphData.nodes.some((n: any) => n.entityType === k),
            )
            .slice(0, 6)
            .map(([type, c]) => (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: c }}
                />
                {type}
              </span>
            ))}
          {graphData.nodes.some(
            (n: any) => !n.entityType && n.nodeType === "entity",
          ) && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: ENTITY_COLOR }}
              />
              Untyped
            </span>
          )}
        </div>
      </div>
    );
  },
);
