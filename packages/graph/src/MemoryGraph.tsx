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
  communityColor,
  computeCommunityLayout,
  darkenColor,
  degreeRadius,
  isDarkMode,
  endpointId,
  expandNeighborhood,
  labelsVisibleAtScale,
  wrapLabelLines,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
  type GraphClassification,
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
import { GraphLabelToggles } from "./GraphLabelToggles.js";
import { useGraphPointer } from "./use-graph-pointer.js";

export interface MemoryGraphNode {
  id: string;
  label: string;
  nodeType: string;
  strategy: string | null;
  entityType: string | null;
  edgeCount: number;
  latestThreadId: string | null;
  bankId: string | null;
  bankName: string | null;
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
      /** Whether the anchoring node is the edge's source or target. */
      direction: "in" | "out";
    }[];
  } | null;
  /** Community hue for the node whose label matches (case-insensitive) —
   *  lets detail surfaces color-code node badges consistently with the
   *  canvas. */
  getNodeColorByLabel: (label: string) => string | undefined;
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
  /** Dims memory nodes whose `strategy` is not in this set. Mirrors the
   *  table's Type(strategy) facet so the same selection filters both views. */
  strategyFilter?: string[];
  /** Span every bank in the tenant (operator surface) and tag nodes with
   *  their bank so the graph can be filtered by bank. */
  allTenantBanks?: boolean;
  /** Reports the distinct banks present in the graph, for a Bank facet. */
  onBanksLoaded?: (banks: { id: string; name: string }[]) => void;
  /** Dims nodes whose `bankId` is not in this set. */
  bankFilter?: string[];
  searchQuery?: string;
  hideFiltered?: boolean;
  /** Optional render slot for the loading state. */
  loadingFallback?: React.ReactNode;
  /** Optional render slot for the empty state. */
  emptyFallback?: React.ReactNode;
}

/** Degree used for sizing — normalized against the graph's max degree at
 *  render time so every view fills the same visual size range. */
function nodeDegree(node: any): number {
  return node.nodeType === "memory" ? 6 : node.edgeCount || 1;
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
      strategyFilter,
      allTenantBanks,
      onBanksLoaded,
      bankFilter,
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
      variables: {
        userId: effectiveUserId ?? null,
        allTenantBanks: allTenantBanks ?? false,
      },
      pause:
        isMultiAgent ||
        (!effectiveUserId && !useRequesterScope && !allTenantBanks),
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
      getNodeColorByLabel: (label: string) => {
        const normalized = label.trim().toLowerCase();
        const node = (graphDataRef.current.nodes as any[]).find(
          (n) => (n.label ?? "").trim().toLowerCase() === normalized,
        );
        if (!node) return undefined;
        return communityColor(
          communityLayoutRef.current.communityByNode.get(node.id),
        );
      },
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
              bankId: n.bankId ?? null,
              bankName: n.bankName ?? null,
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
              bankId: n.bankId ?? null,
              bankName: n.bankName ?? null,
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

    // Report banks for the Bank facet. The authoritative list comes from the
    // query's `banks` field (tenant-enumerated server-side), so every bank is
    // filterable even when none of its entities survive the graph's per-bank
    // cap — the facet must never depend on which nodes happened to render.
    // Node-derived banks remain the fallback for the multi-agent path and
    // older servers that don't return `banks`.
    const prevBanksRef = useRef<string>("");
    useEffect(() => {
      if (!onBanksLoaded) return;
      const banks = new Map<string, string>();
      if (isMultiAgent) {
        for (const graph of Object.values(multiResults)) {
          for (const b of ((graph as any)?.banks ?? []) as Array<{
            id: string;
            name: string;
          }>) {
            if (b?.id && !banks.has(b.id)) banks.set(b.id, b.name ?? b.id);
          }
        }
      } else {
        for (const b of (singleResult.data?.memoryGraph?.banks ?? []) as Array<{
          id: string;
          name: string;
        }>) {
          if (b?.id && !banks.has(b.id)) banks.set(b.id, b.name ?? b.id);
        }
      }
      if (banks.size === 0) {
        if (allNodes.length === 0) return;
        for (const n of allNodes) {
          if (n.bankId && !banks.has(n.bankId)) {
            banks.set(n.bankId, n.bankName ?? n.bankId);
          }
        }
      }
      const list = Array.from(banks, ([id, name]) => ({ id, name })).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      const key = list.map((b) => b.id).join(",");
      if (key !== prevBanksRef.current) {
        prevBanksRef.current = key;
        onBanksLoaded(list);
      }
    }, [
      allNodes,
      onBanksLoaded,
      isMultiAgent,
      multiResults,
      singleResult.data,
    ]);

    // Determine which nodes match filters
    const hasFilter =
      (typeFilter && typeFilter.length > 0) ||
      (strategyFilter && strategyFilter.length > 0) ||
      (bankFilter && bankFilter.length > 0) ||
      !!searchQuery;

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
      if (strategyFilter && strategyFilter.length > 0) {
        const stratSet = new Set(strategyFilter);
        filtered = filtered.filter(
          (n) => n.strategy != null && stratSet.has(n.strategy),
        );
      }
      if (bankFilter && bankFilter.length > 0) {
        const bankSet = new Set(bankFilter);
        filtered = filtered.filter(
          (n) => n.bankId != null && bankSet.has(n.bankId),
        );
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
    }, [
      allNodes,
      typeFilter,
      strategyFilter,
      bankFilter,
      searchQuery,
      hasFilter,
    ]);

    // Build graph data from raw sources only — filter state is NOT a dep.
    // Mute/highlight on filter changes is applied by mutating material
    // opacity in-place (see effect below), not by rebuilding graphData.
    // Rebuilding would give ForceGraph3D a new identity → restart the
    // simulation and reset the camera on every keystroke.
    const prevGraphRef = useRef<{
      key: string;
      data: { nodes: MemoryGraphNode[]; links: any[] };
    } | null>(null);
    const graphData = useMemo(() => {
      // Content-keyed identity: identical refetch payloads keep the
      // existing graphData object so the engine never restarts for them.
      const key = JSON.stringify(
        isMultiAgent ? multiResults : (singleResult.data?.memoryGraph ?? null),
      );
      if (prevGraphRef.current && prevGraphRef.current.key === key) {
        return prevGraphRef.current.data;
      }
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
      carryNodePositions(prevGraphRef.current?.data.nodes ?? null, allNodes);
      const data = { nodes: allNodes, links };
      prevGraphRef.current = { key, data };
      return data;
    }, [allNodes, isMultiAgent, multiResults, singleResult.data]);

    // Community layout runs at graphData-identity cadence only — never on
    // filter or focus changes.
    const communityLayout = useMemo(
      () => computeCommunityLayout(graphData.nodes, graphData.links),
      [graphData],
    );
    const communityLayoutRef = useRef(communityLayout);
    communityLayoutRef.current = communityLayout;

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
      // Focus narrows which labels are eligible (the lit set) but the
      // zoom gate still applies — labels stay hidden until zoomed in.
      const gate = labelsVisibleAtScale(
        zoomKRef.current,
        graphDataRef.current.nodes.length,
      );
      const focusState = focusRef.current;
      if (focusState) return gate && focusState.litIds.has(nodeId);
      return gate;
    }, []);

    const linkLabelVisible = useCallback((link: any) => {
      // Relationship labels ride the line itself (neo4j style). Off hides
      // them everywhere; in focus they mark the lit set; in the overview
      // they follow the same zoom gate as node labels.
      if (labelModeRef.current === "off") return false;
      if (labelModeRef.current === "on") return true;
      // The zoom gate applies in focus mode too — focus only narrows
      // which edges are eligible (the lit set).
      const gate = labelsVisibleAtScale(
        zoomKRef.current,
        graphDataRef.current.nodes.length,
      );
      if (!gate) return false;
      const focusState = focusRef.current;
      if (focusState) {
        return (
          focusState.litIds.has(endpointId(link.source)) &&
          focusState.litIds.has(endpointId(link.target))
        );
      }
      return true;
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
            direction: (sId === nodeId ? "out" : "in") as "in" | "out",
          };
        });
      edges.sort((a, b) => a.targetLabel.localeCompare(b.targetLabel));
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
        // Color by detected community so cluster membership reads at a
        // glance — entity-type colors were near-uniform in practice.
        const color = communityColor(
          communityLayoutRef.current.communityByNode.get(node.id),
        );
        const r = nodeRadius(node);

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(0.75, r * 0.05);
        ctx.strokeStyle = darkenColor(color);
        ctx.stroke();

        if (nodeLabelVisible(node.id)) {
          const rawLabel = isMemory ? "Memory" : (node.label ?? "");
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

    // Full link painter (replace mode): the line is trimmed to the disc
    // edges with the arrowhead terminating at the target's rim — lines
    // never run under translucent discs. Relationship labels draw along
    // lit edges (focus mode only), constant on-screen size, upright.
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

        // Mute the connecting lines only while FILTERING (search / facet) —
        // NOT when a node is merely selected/focused. Focus keeps the normal
        // bright/dim treatment so the selected neighborhood stays legible.
        const filtering = !!matchedIdsRef.current;
        const bright = isLinkBright(link);
        const color = filtering
          ? bright
            ? "rgba(148,163,184,0.3)"
            : "rgba(148,163,184,0.05)"
          : bright
            ? "rgba(148,163,184,0.9)"
            : "rgba(148,163,184,0.15)";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        // Constant 1px screen width regardless of zoom.
        ctx.lineWidth = 1 / globalScale;

        let labeled = false;
        if (linkLabelVisible(link)) {
          const label = link.label || "mentions";
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
      const baseDistance = nodeCount > 50 ? 85 : 65;
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
          .radius((node: any) => nodeRadius(node) + 14)
          .strength(0.9),
      );
      // `dims` is a dep so this re-runs once ForceGraph3D actually mounts —
      // the first pass fires before the container is measured (fg == null).
    }, [graphData, communityLayout, dims]);

    // Geometric pointer handling — replaces the library's canvas-picking
    // (broken under Brave/Firefox fingerprinting protection).
    const { tooltip } = useGraphPointer({
      containerEl,
      fgRef,
      graphDataRef,
      nodeRadius,
      tooltipText: (node: any) =>
        `${node.label}${node.entityType ? ` (${node.entityType})` : ""}${
          node.edgeCount ? ` — ${node.edgeCount} mentions` : ""
        }`,
      onNodeClick: (node: any) => {
        // Clicking a node focuses it and surfaces the selected-node chip —
        // the detail sheet opens only from the chip.
        focusNode(node.id);
        setSelectedNode(node as MemoryGraphNode);
      },
      onBackgroundClick: () => {
        if (focusRef.current) exitFocus();
      },
    });

    // One-shot framing: zoom to fit after the first simulation settle.
    // Zoom/pan after that belongs to the user.
    const zoomInitRef = useRef(false);
    // The first paint happens at the default zoom for a frame before
    // onEngineStop applies the fit — keep the canvas invisible until the
    // framing has landed so there's no visible jump.
    const [framed, setFramed] = useState(false);

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
      <div
        ref={setContainerEl}
        data-testid="graph-container"
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
          // Continuous repaint so ref-driven focus/filter/zoom changes show
          // without rebuilding graphData (the 2D analog of the old
          // material-mutation + refresh pattern).
          autoPauseRedraw={false}
          enablePointerInteraction={false}
          linkLabel={(link: any) => link.label || "mentions"}
          linkCanvasObjectMode={() => "replace" as const}
          linkCanvasObject={linkCanvasObject}
          // Settle the layout synchronously before the first paint: zero
          // cooldown until the initial framing lands (no load animation),
          // then normal cooldown so dragging a node relaxes its neighbors.
          cooldownTicks={
            graphData.nodes.length > 300 ? (framed ? 120 : 0) : 300
          }
          // Warmup runs at slow decay so the pre-paint settle converges
          // fully (communities separate); once framed, fast decay keeps
          // drag-triggered reheats snappy.
          d3AlphaDecay={
            graphData.nodes.length > 300
              ? framed
                ? 0.05
                : graphData.nodes.length > 2000
                  ? 0.035
                  : 0.0115
              : 0.0228
          }
          d3VelocityDecay={graphData.nodes.length > 300 ? 0.55 : 0.4}
          warmupTicks={
            graphData.nodes.length > 300
              ? graphData.nodes.length > 2000
                ? 200
                : 600
              : 0
          }
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
        />
        {/* Overlay chrome lives in its own explicit stacking layer above
            the canvas; the layer passes pointer events through except on
            the interactive controls. */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {focus && selectedNode && (
            <div className="pointer-events-auto absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
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
          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md whitespace-nowrap backdrop-blur-sm"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              {tooltip.text}
            </div>
          )}
          <GraphLabelToggles
            labelMode={labelMode}
            onLabelModeChange={setLabelMode}
          />
        </div>
      </div>
    );
  },
);
