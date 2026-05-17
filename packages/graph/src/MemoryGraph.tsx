/**
 * MemoryGraph — 3D force-graph rendering Hindsight memories + entities.
 *
 * Performance patterns (in-place opacity mute on filter, one-shot camera
 * init, stable nodeThreeObject) are load-bearing — each one exists to
 * avoid a camera reset or simulation restart on filter-keystrokes. Do
 * not "clean up" those without measuring.
 *
 * Ported from apps/admin/src/components/MemoryGraph.tsx in U2 of the
 * apps/computer Memory port (plan
 * docs/plans/2026-05-09-003-feat-computer-memory-ui-port-plan.md). Both
 * apps/admin and apps/computer consume this version.
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
import { MemoryGraphQuery } from "./queries.js";
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
      return { nodes: allNodes, links };
    }, [allNodes, isMultiAgent, multiResults, singleResult.data]);

    // Ref so nodeThreeObject (stable callback) can read the current filter
    // without being re-created each time matchedIds changes.
    const matchedIdsRef = useRef<Set<string> | null>(null);
    matchedIdsRef.current = matchedIds;

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

    const nodeThreeObject = useCallback((node: any) => {
      const matched = matchedIdsRef.current;
      const muted = matched ? !matched.has(node.id) : false;
      const isMemory = node.nodeType === "memory";
      const entityType = node.entityType as string | null;
      const label = isMemory
        ? "Memory"
        : entityType
          ? entityType.charAt(0).toUpperCase() + entityType.slice(1)
          : node.label?.slice(0, 12) || "Entity";
      const color = isMemory
        ? MEMORY_COLOR
        : entityType
          ? MEMORY_TYPE_COLORS[entityType] || ENTITY_COLOR
          : ENTITY_COLOR;
      // Size by mention count (edgeCount carries mention_count from resolver)
      const mentions = node.edgeCount || 1;
      const r = isMemory
        ? 10
        : Math.max(5, Math.min(18, 5 + Math.sqrt(mentions) * 1.5));
      const opacity = muted ? 0.15 : 1;

      const group = new THREE.Group();

      // Sphere — always transparent so runtime opacity tweaks take effect
      const geometry = new THREE.SphereGeometry(r, 16, 16);
      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity,
      });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

      // Text label via sprite — canvas drawn pure white; mute effect comes
      // from spriteMaterial.opacity so we don't have to redraw the canvas
      // when the filter changes.
      const canvas = document.createElement("canvas");
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      const fontSize = isMemory ? 18 : 14;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, size / 2, size / 2);
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(r * 3, r * 3, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);

      // Stash material refs so the filter effect can mutate opacity without
      // rebuilding the graph.
      node.__sphereMat = material;
      node.__spriteMat = spriteMaterial;

      return group;
    }, []);

    // Apply filter via in-place material opacity — NO graphData rebuild.
    useEffect(() => {
      for (const n of graphData.nodes as any[]) {
        const muted = matchedIds ? !matchedIds.has(n.id) : false;
        const op = muted ? 0.15 : 1;
        if (n.__sphereMat) n.__sphereMat.opacity = op;
        if (n.__spriteMat) n.__spriteMat.opacity = op;
      }
      fgRef.current?.refresh?.();
    }, [matchedIds, graphData]);

    // Force layout tuning — safe to re-run when data changes (strengths
    // scale with node count). Does NOT touch the camera, so filter updates
    // no longer reset the user's zoom/pan.
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg) return;
      const nodeCount = graphData.nodes.length;
      const chargeStrength = nodeCount > 50 ? -120 : -80;
      fg.d3Force("charge")?.strength(chargeStrength).distanceMax(200);
      fg.d3Force("link")?.distance(nodeCount > 50 ? 70 : 55);
      fg.d3Force("center")?.strength(1);
      fg.d3Force("collide", d3.forceCollide().radius(20).strength(0.8));
    }, [graphData]);

    // Camera + controls setup — runs exactly once when the ForceGraph is
    // first available. Zoom/pan after that belongs to the user (and the
    // zoom-to-fit effect above).
    const cameraInitRef = useRef(false);
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg || !dims || cameraInitRef.current) return;
      const camera = fg.camera();
      const controls = fg.controls();
      // Scale starting distance with node count so large graphs start framed.
      const nodeCount = graphData.nodes.length;
      const initialZ = Math.max(
        800,
        Math.min(6000, 100 * Math.sqrt(nodeCount)),
      );
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
            const m = matchedIdsRef.current;
            if (!m) return "rgba(255,255,255,0.7)";
            const sId =
              typeof link.source === "object" ? link.source.id : link.source;
            const tId =
              typeof link.target === "object" ? link.target.id : link.target;
            return m.has(sId) || m.has(tId)
              ? "rgba(255,255,255,0.7)"
              : "rgba(255,255,255,0.1)";
          }}
          linkWidth={() => 2}
          linkDirectionalArrowLength={() => 4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(link: any) => {
            const m = matchedIdsRef.current;
            if (!m) return "rgba(255,255,255,0.7)";
            const sId =
              typeof link.source === "object" ? link.source.id : link.source;
            const tId =
              typeof link.target === "object" ? link.target.id : link.target;
            return m.has(sId) || m.has(tId)
              ? "rgba(255,255,255,0.7)"
              : "rgba(255,255,255,0.1)";
          }}
          linkLabel={(link: any) => link.label || "mentions"}
          nodeLabel={(node: any) =>
            `${node.label}${node.entityType ? ` (${node.entityType})` : ""}${
              node.edgeCount ? ` — ${node.edgeCount} mentions` : ""
            }`
          }
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={50}
          onNodeClick={(node: any) => {
            if (!onNodeClick) return;
            const edges = graphData.links
              .filter((l: any) => {
                const sId =
                  typeof l.source === "object" ? l.source.id : l.source;
                const tId =
                  typeof l.target === "object" ? l.target.id : l.target;
                return sId === node.id || tId === node.id;
              })
              .map((l: any) => {
                const sId =
                  typeof l.source === "object" ? l.source.id : l.source;
                const tId =
                  typeof l.target === "object" ? l.target.id : l.target;
                const otherId = sId === node.id ? tId : sId;
                const otherNode = graphData.nodes.find(
                  (n: any) => n.id === otherId,
                );
                return {
                  label: l.label || "MENTIONS",
                  targetLabel: otherNode?.label ?? otherId,
                  targetType: otherNode?.nodeType ?? "unknown",
                  targetId: otherId,
                };
              });
            onNodeClick(node as MemoryGraphNode, edges);
          }}
          onNodeDragEnd={(node: any) => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
          }}
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
