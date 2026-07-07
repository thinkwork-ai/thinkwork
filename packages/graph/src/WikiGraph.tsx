/**
 * WikiGraph — force-graph rendering compiled wiki pages and their
 * [[...]] links. Near-clone of MemoryGraph.tsx with the data source
 * swapped from Hindsight entities to wiki_pages/wiki_page_links.
 *
 * Performance patterns (in-place opacity mute on filter, one-shot camera
 * init, stable nodeThreeObject) carry over intact — each one exists to
 * avoid a camera reset or simulation restart on filter-keystrokes. Do
 * not "clean up" those without measuring.
 *
 * When a filter is active, nodes partition into matched (full color),
 * 1-hop neighbors of a match (muted 0.15 fill + colored outline ring
 * in the node's type color), and other (muted 0.15 fill only). Edges
 * stay visible — full opacity when at least one endpoint is matched,
 * muted when both are unmatched. The whole graph remains visible;
 * nothing is hidden. Opacities are applied in-place via stashed
 * material refs so a filter change doesn't restart the force sim.
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
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useQuery, useClient } from "urql";
import * as d3 from "d3-force";
import { WikiGraphQuery } from "./queries.js";
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
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
import { makeEdgeLabelSprite } from "./three-label-sprite.js";
import { GraphLabelToggles } from "./GraphLabelToggles.js";
import {
  PAGE_TYPES,
  PAGE_TYPE_FORCE_COLORS,
  PAGE_TYPE_DEFAULT_FORCE_COLOR,
  PAGE_TYPE_LABELS,
  type WikiPageType,
} from "./palettes/wiki-palette.js";

export type { WikiPageType };

export interface WikiGraphNode {
  id: string;
  label: string;
  nodeType: "page";
  entityType: WikiPageType;
  entitySubtype?: string | null;
  displayType?: string | null;
  slug: string;
  edgeCount: number;
  /** In multi-user mode the node id is prefixed with `${userId}:`; the
   *  unprefixed `pageId` and the owning `userId` are exposed separately so
   *  the detail sheet can fetch the page without re-parsing the compound
   *  id. `agentId` is retained as a legacy property name for callers. */
  pageId: string;
  agentId: string;
}

export interface WikiGraphHandle {
  refetch: () => void;
  getNodeWithEdges: (nodeId: string) => {
    node: WikiGraphNode;
    edges: {
      label: string;
      targetLabel: string;
      targetType: string;
      targetId: string;
    }[];
  } | null;
}

interface WikiGraphProps {
  tenantId: string;
  userId?: string;
  userIds?: string[];
  /** @deprecated Use userId. */
  agentId?: string;
  /** @deprecated Use userIds. */
  agentIds?: string[];
  useRequesterScope?: boolean;
  onNodeClick?: (
    node: WikiGraphNode,
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
  /** Optional render slot for the loading state. */
  loadingFallback?: React.ReactNode;
  /** Optional render slot for the empty state. */
  emptyFallback?: React.ReactNode;
}

type WikiGraphLink = {
  source: string;
  target: string;
  label: string;
  weight: number;
};

export function buildConnectedWikiGraphData(
  allNodes: WikiGraphNode[],
  sourceGraphs: Iterable<[string | null, any]>,
): { nodes: WikiGraphNode[]; links: WikiGraphLink[] } {
  const nodeIds = new Set(allNodes.map((n) => n.id));
  const links: WikiGraphLink[] = [];

  for (const [prefix, graph] of sourceGraphs) {
    if (!graph) continue;
    for (const e of (graph as any).edges ?? []) {
      const source = prefix ? `${prefix}:${e.source}` : e.source;
      const target = prefix ? `${prefix}:${e.target}` : e.target;
      if (!nodeIds.has(source) || !nodeIds.has(target)) continue;

      links.push({
        source,
        target,
        label: e.label ?? "references",
        weight: e.weight ?? 0.5,
      });
    }
  }

  return {
    nodes: allNodes,
    links,
  };
}

/** Node radius by degree — shared by rendering and the collide force so
 *  discs can never be forced to overlap. */
function wikiNodeRadius(node: any): number {
  const degree = node.edgeCount || 1;
  return Math.max(8, Math.min(24, 8 + Math.sqrt(degree) * 2));
}

export const WikiGraph = forwardRef<WikiGraphHandle, WikiGraphProps>(
  function WikiGraph(
    {
      tenantId,
      userId,
      userIds,
      agentId,
      agentIds,
      useRequesterScope = false,
      onNodeClick,
      onTypesLoaded,
      typeFilter,
      searchQuery,
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

    // Single-agent path: urql subscription-style query.
    const [singleResult, singleReexecute] = useQuery({
      query: WikiGraphQuery,
      variables: { tenantId, userId: effectiveUserId ?? null },
      requestPolicy: "cache-and-network",
      pause:
        isMultiAgent || (!effectiveUserId && !useRequesterScope) || !tenantId,
    });

    // Multi-agent: fan out per-agent, same shape as MemoryGraph does. One
    // round-trip per agent keeps resolver complexity flat; tenants are
    // <10 agents today.
    const [multiResults, setMultiResults] = useState<Record<string, any>>({});
    const [multiFetching, setMultiFetching] = useState(false);

    const fetchAllAgents = useCallback(async () => {
      if (!effectiveUserIds || effectiveUserIds.length === 0 || !tenantId) {
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
                .query(
                  WikiGraphQuery,
                  { tenantId, userId: id },
                  {
                    requestPolicy: "network-only",
                  },
                )
                .toPromise();
              if (res.error) {
                console.warn(
                  `[WikiGraph] wikiGraph failed for user ${id}:`,
                  res.error.message,
                );
              }
              results[id] = res.data?.wikiGraph;
            } catch (err) {
              console.warn(`[WikiGraph] wikiGraph threw for user ${id}:`, err);
              results[id] = { nodes: [], edges: [] };
            }
          }),
        );
        setMultiResults(results);
      } finally {
        setMultiFetching(false);
      }
    }, [effectiveUserIds, client, tenantId]);

    useEffect(() => {
      if (isMultiAgent) fetchAllAgents();
    }, [isMultiAgent, fetchAllAgents]);

    const getNodeWithEdgesRef = useRef<WikiGraphHandle["getNodeWithEdges"]>(
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

    const allNodes = useMemo(() => {
      const nodes: WikiGraphNode[] = [];
      if (isMultiAgent) {
        for (const [aid, graph] of Object.entries(multiResults)) {
          if (!graph) continue;
          for (const n of (graph as any).nodes ?? []) {
            nodes.push({
              id: `${aid}:${n.id}`,
              pageId: n.id,
              agentId: aid,
              label: n.label ?? n.id,
              nodeType: "page",
              entityType: (n.entityType as WikiPageType) ?? "ENTITY",
              entitySubtype: n.entitySubtype ?? null,
              displayType: n.displayType ?? null,
              slug: n.slug,
              edgeCount: n.edgeCount ?? 0,
            });
          }
        }
      } else {
        const graph = singleResult.data?.wikiGraph;
        if (graph) {
          for (const n of graph.nodes ?? []) {
            nodes.push({
              id: n.id,
              pageId: n.id,
              agentId: effectiveUserId ?? "",
              label: n.label ?? n.id,
              nodeType: "page",
              entityType: (n.entityType as WikiPageType) ?? "ENTITY",
              entitySubtype: n.entitySubtype ?? null,
              displayType: n.displayType ?? null,
              slug: n.slug,
              edgeCount: n.edgeCount ?? 0,
            });
          }
        }
      }
      return nodes;
    }, [isMultiAgent, multiResults, singleResult.data, effectiveUserId]);

    // Surface the present type set to the parent (for a future filter UI).
    const prevTypesRef = useRef<string>("");
    useEffect(() => {
      if (!onTypesLoaded || allNodes.length === 0) return;
      const types = new Set<string>();
      for (const n of allNodes) {
        types.add(
          n.displayType ?? PAGE_TYPE_LABELS[n.entityType] ?? n.entityType,
        );
      }
      const sorted = Array.from(types).sort();
      const key = sorted.join(",");
      if (key !== prevTypesRef.current) {
        prevTypesRef.current = key;
        onTypesLoaded(sorted);
      }
    }, [allNodes, onTypesLoaded]);

    const hasFilter = (typeFilter && typeFilter.length > 0) || !!searchQuery;

    const matchedIds = useMemo(() => {
      if (!hasFilter) return null;
      let filtered = allNodes;
      if (typeFilter && typeFilter.length > 0) {
        const filterSet = new Set(typeFilter);
        filtered = filtered.filter((n) =>
          filterSet.has(
            n.displayType ?? PAGE_TYPE_LABELS[n.entityType] ?? n.entityType,
          ),
        );
      }
      if (searchQuery) {
        const q = normalizeGraphSearch(searchQuery);
        filtered = filtered.filter((n) =>
          normalizeGraphSearch(n.label).includes(q),
        );
      }
      return new Set(filtered.map((n) => n.id));
    }, [allNodes, typeFilter, searchQuery, hasFilter]);

    // graphData rebuilds only when the raw source changes — NOT on filter.
    // Filter mute is in-place material opacity (see effect below). Isolated
    // compiled pages stay visible so the graph and table agree on whether
    // wiki data exists.
    const prevNodesRef = useRef<WikiGraphNode[] | null>(null);
    const graphData = useMemo(() => {
      const data = isMultiAgent
        ? buildConnectedWikiGraphData(allNodes, Object.entries(multiResults))
        : buildConnectedWikiGraphData(allNodes, [
            [null, singleResult.data?.wikiGraph],
          ]);
      // Keep simulation positions and user-drag pins stable across
      // refetches — fresh node objects would otherwise scatter the layout.
      carryNodePositions(prevNodesRef.current, data.nodes);
      prevNodesRef.current = data.nodes;
      return data;
    }, [allNodes, isMultiAgent, multiResults, singleResult.data]);

    // Community layout runs at graphData-identity cadence only — the same
    // cadence the simulation keys on. Never recomputed on filter or focus.
    const communityLayout = useMemo(
      () => computeCommunityLayout(graphData.nodes, graphData.links),
      [graphData],
    );

    const matchedIdsRef = useRef<Set<string> | null>(null);
    matchedIdsRef.current = matchedIds;

    // 3-state: matched (full color), 1-hop neighbor of a match (muted
    // fill + colored outline ring), other (muted fill only). Edges stay
    // visible: full opacity when at least one endpoint is matched,
    // muted when both are unmatched. Nothing is hidden — the whole
    // graph remains visible so users keep spatial context.
    const searchClassification = useMemo<GraphClassification | null>(
      () => deriveGraphClassification(matchedIds, graphData.links),
      [matchedIds, graphData],
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
    const [selectedNode, setSelectedNode] = useState<WikiGraphNode | null>(
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
            label: l.label || "references",
            targetLabel: otherNode?.label ?? otherId,
            targetType: otherNode?.displayType ?? otherNode?.nodeType ?? "page",
            targetId: otherId,
          };
        });
      return { node: node as WikiGraphNode, edges };
    };

    const nodeThreeObject = useCallback(
      (node: any) => {
        const state = classifyNode(node.id, classificationRef.current);

        const entityType = node.entityType as WikiPageType;
        const color =
          PAGE_TYPE_FORCE_COLORS[entityType] ?? PAGE_TYPE_DEFAULT_FORCE_COLOR;
        // Clip the label to keep the canvas readable without losing the full
        // title from the tooltip (nodeLabel callback below passes the raw
        // title to ForceGraph3D).
        const rawLabel = node.label ?? "";
        const label =
          rawLabel.length > 16 ? rawLabel.slice(0, 15) + "…" : rawLabel;
        // Size by degree. Pages with more links render bigger.
        const degree = node.edgeCount || 1;
        const r = wikiNodeRadius(node);

        const sphereOp = state === "matched" ? 1 : 0.15;
        const labelOp = sphereOp;
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
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: labelOp,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(r * 3, r * 3, 1);
        sprite.position.set(0, 0, 2);
        sprite.visible = nodeLabelVisible(node.id);
        group.add(sprite);

        // Colored outline ring — visible only on 1-hop neighbors of a
        // matched node. Canvas sprite so it always faces the camera.
        // Scale = sphere diameter (r * 2) so the stroke sits inside the
        // sphere's footprint and the node doesn't visually grow when it
        // becomes a neighbor.
        const ringCanvas = document.createElement("canvas");
        const rSize = 128;
        ringCanvas.width = rSize;
        ringCanvas.height = rSize;
        const rCtx = ringCanvas.getContext("2d")!;
        rCtx.clearRect(0, 0, rSize, rSize);
        rCtx.strokeStyle = color;
        rCtx.lineWidth = 10;
        rCtx.beginPath();
        rCtx.arc(rSize / 2, rSize / 2, rSize / 2 - 10, 0, Math.PI * 2);
        rCtx.stroke();
        const ringTexture = new THREE.CanvasTexture(ringCanvas);
        const ringMaterial = new THREE.SpriteMaterial({
          map: ringTexture,
          transparent: true,
          opacity: ringOp,
        });
        const ringSprite = new THREE.Sprite(ringMaterial);
        ringSprite.scale.set(r * 2, r * 2, 1);
        ringSprite.position.set(0, 0, 1);
        group.add(ringSprite);

        // Stash materials so filter-mute can adjust opacity without rebuilding
        // the graphData (which would restart the simulation).
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
      for (const n of graphData.nodes as any[]) {
        const state = classifyNode(n.id, classification);
        const sphereOp = state === "matched" ? 1 : 0.15;
        const ringOp = state === "neighbor" ? 1 : 0;
        if (n.__sphereMat) n.__sphereMat.opacity = sphereOp;
        if (n.__rimMat) n.__rimMat.opacity = sphereOp;
        if (n.__spriteMat) n.__spriteMat.opacity = sphereOp;
        if (n.__ringMat) n.__ringMat.opacity = ringOp;
      }
      // Focus flips which labels are lit; refresh() also re-runs the link
      // object accessor so lit edges gain/drop their label sprites.
      applyLabelVisibility();
      fgRef.current?.refresh?.();
    }, [classification, graphData, applyLabelVisibility]);

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

      const chargeStrength = nodeCount > 50 ? -200 : -130;
      fg.d3Force("charge")?.strength(chargeStrength).distanceMax(200);
      // Community-aware springs: short/strong inside a community, long/weak
      // across the bridge edges, so clusters densify without collapsing
      // into each other.
      const baseDistance = nodeCount > 50 ? 100 : 75;
      const linkForce = fg.d3Force("link");
      linkForce?.distance((link: any) =>
        sameCommunity(link) ? baseDistance * 0.7 : baseDistance * 1.8,
      );
      linkForce?.strength?.((link: any) => (sameCommunity(link) ? 0.6 : 0.05));
      // Per-community anchors replace the global center force — anchors
      // are packed around the origin so the graph stays framed. Nodes
      // without an assignment (defensive) fall back to center attraction.
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
          .radius((node: any) => wikiNodeRadius(node) + 6)
          .strength(0.9),
      );
      // `dims` is a dep so this re-runs once ForceGraph3D actually mounts —
      // the first pass fires before the container is measured (fg == null).
    }, [graphData, communityLayout, dims]);

    // One-shot camera setup. After this the user owns zoom/pan.
    const cameraInitRef = useRef(false);
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg || !dims || cameraInitRef.current) return;
      const camera = fg.camera();
      const controls = fg.controls();
      // Scale starting distance with node count so large graphs start
      // framed. No post-settle zoom — zoomToFit over-corrects and shoves
      // the whole layout into a tiny center blob.
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
            <p className="text-sm text-muted-foreground max-w-sm">
              No compiled memory pages yet — ask an agent a few questions and
              come back in a few minutes.
            </p>
          </div>
        )
      );
    }

    // Edge brightness follows endpoint lit-state. In focus mode an edge is
    // bright only when BOTH endpoints are lit — a half-lit edge would imply
    // the outside node belongs to the neighborhood. Search keeps the
    // either-endpoint rule. Reads refs so identity stays inert; repaints
    // ride the classification effect's refresh().
    const isLinkBright = (link: any) => {
      const sId = endpointId(link.source);
      const tId = endpointId(link.target);
      const focusLit = focusRef.current?.litIds;
      if (focusLit) return focusLit.has(sId) && focusLit.has(tId);
      const m = matchedIdsRef.current;
      if (!m) return true;
      return m.has(sId) || m.has(tId);
    };

    const typeCounts = PAGE_TYPES.map((t) => ({
      type: t,
      count: graphData.nodes.filter(
        (n: any) => (n.entityType as WikiPageType) === t,
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
              ? "rgba(148,163,184,0.9)"
              : "rgba(148,163,184,0.12)"
          }
          linkWidth={1.2}
          linkLabel={(link: any) => link.label || "references"}
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
            if (mode === "off" || !lit) {
              link.__labelSprite = undefined;
              return undefined as unknown as THREE.Object3D;
            }
            const sprite = makeEdgeLabelSprite(link.label || "references");
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
            `${node.label}${
              node.displayType || node.entityType
                ? ` (${node.displayType ?? PAGE_TYPE_LABELS[node.entityType as WikiPageType] ?? node.entityType})`
                : ""
            }${node.edgeCount ? ` — ${node.edgeCount} link${node.edgeCount === 1 ? "" : "s"}` : ""}`
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
            setSelectedNode(node as WikiGraphNode);
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
          {typeCounts
            .filter((t) => t.count > 0)
            .map((t) => (
              <span key={t.type} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: PAGE_TYPE_FORCE_COLORS[t.type] }}
                />
                {PAGE_TYPE_LABELS[t.type]} ({t.count})
              </span>
            ))}
        </div>
      </div>
    );
  },
);
