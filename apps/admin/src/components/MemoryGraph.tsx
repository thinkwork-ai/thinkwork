import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useQuery, useClient } from "urql";
import { Loader2, Sparkles } from "lucide-react";
import * as d3 from "d3-force";
import { MemoryGraphQuery } from "@/lib/graphql-queries";

const MEMORY_COLOR = "#e879a0";
const ENTITY_COLOR = "#7dd3fc";
const AGENT_COLOR = "#34d399";

// Ontology type → color mapping
const TYPE_COLORS: Record<string, string> = {
  Person: "#34d399",     // green
  Company: "#60a5fa",    // blue
  Org: "#60a5fa",        // blue
  Location: "#fbbf24",   // amber
  Restaurant: "#f97316", // orange
  Product: "#a78bfa",    // purple
  Software: "#a78bfa",   // purple
  System: "#a78bfa",     // purple
  Event: "#f472b6",      // pink
  Decision: "#fb923c",   // orange
  Concept: "#94a3b8",    // slate
  Document: "#67e8f9",   // cyan
  Project: "#4ade80",    // lime
  BusinessConcept: "#94a3b8", // slate
  Tool: "#a78bfa",       // purple
};

export interface MemoryGraphNode {
  id: string;
  label: string;
  nodeType: string;
  strategy: string | null;
  entityType: string | null;
  edgeCount: number;
}

export interface MemoryGraphHandle {
  refetch: () => void;
  getNodeWithEdges: (nodeId: string) => { node: MemoryGraphNode; edges: { label: string; targetLabel: string; targetType: string; targetId: string }[] } | null;
}

interface MemoryGraphProps {
  agentId?: string;
  agentIds?: string[];
  agentNames?: Record<string, string>;
  onNodeClick?: (node: MemoryGraphNode, connectedEdges: { label: string; targetLabel: string; targetType: string; targetId: string }[]) => void;
  onTypesLoaded?: (types: string[]) => void;
  typeFilter?: string[];
  searchQuery?: string;
  hideFiltered?: boolean;
}

export const MemoryGraph = forwardRef<MemoryGraphHandle, MemoryGraphProps>(
  function MemoryGraph({ agentId, agentIds, agentNames, onNodeClick, onTypesLoaded, typeFilter, searchQuery, hideFiltered = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const fgRef = useRef<any>(null);
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

    const isMultiAgent = !!agentIds && agentIds.length > 1;
    const client = useClient();

    // Single-agent query (only when not multi-agent)
    const [singleResult, singleReexecute] = useQuery({
      query: MemoryGraphQuery,
      variables: { assistantId: agentId ?? "" },
      pause: isMultiAgent || !agentId,
    });

    // Multi-agent: fetch all graphs manually
    const [multiResults, setMultiResults] = useState<Record<string, any>>({});
    const [multiFetching, setMultiFetching] = useState(false);

    const fetchAllAgents = useCallback(async () => {
      if (!agentIds || agentIds.length === 0) return;
      setMultiFetching(true);
      const results: Record<string, any> = {};
      await Promise.all(
        agentIds.map(async (id) => {
          const res = await client.query(MemoryGraphQuery, { assistantId: id }).toPromise();
          results[id] = res.data?.memoryGraph;
        })
      );
      setMultiResults(results);
      setMultiFetching(false);
    }, [agentIds, client]);

    useEffect(() => {
      if (isMultiAgent) fetchAllAgents();
    }, [isMultiAgent, fetchAllAgents]);

    const getNodeWithEdgesRef = useRef<MemoryGraphHandle["getNodeWithEdges"]>(() => null);

    useImperativeHandle(ref, () => ({
      refetch: () => {
        if (isMultiAgent) fetchAllAgents();
        else singleReexecute({ requestPolicy: "network-only" });
      },
      getNodeWithEdges: (nodeId: string) => getNodeWithEdgesRef.current(nodeId),
    }));

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const measure = () => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w > 0 && h > 0) setDims({ w, h });
      };
      measure();
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

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
            });
          }
        }
      }
      return nodes;
    }, [isMultiAgent, multiResults, singleResult.data, agentIds, agentNames]);

    // Report unique entity types to parent (only when types actually change)
    const prevTypesRef = useRef<string>("");
    useEffect(() => {
      if (!onTypesLoaded || allNodes.length === 0) return;
      const types = new Set<string>();
      for (const n of allNodes) {
        if (n.nodeType === "memory") types.add("Memory");
        else if (n.entityType) types.add(n.entityType.charAt(0).toUpperCase() + n.entityType.slice(1));
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
          const et = n.entityType ? n.entityType.charAt(0).toUpperCase() + n.entityType.slice(1) : "";
          return filterSet.has(et);
        });
      }
      if (searchQuery) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const q = normalize(searchQuery);
        filtered = filtered.filter((n) => normalize(n.label).includes(q));
      }
      return new Set(filtered.map((n) => n.id));
    }, [allNodes, typeFilter, searchQuery, hasFilter]);

    // Build graph data — hide or mute unmatched nodes
    const graphData = useMemo(() => {
      const visibleNodes = (hideFiltered && matchedIds)
        ? allNodes.filter((n) => matchedIds.has(n.id))
        : allNodes.map((n) => ({
            ...n,
            __muted: matchedIds ? !matchedIds.has(n.id) : false,
          }));

      const nodeIds = new Set(visibleNodes.map((n) => n.id));

      // Build links
      const links: { source: string; target: string; label: string; weight: number }[] = [];
      if (isMultiAgent) {
        for (const [aid, graph] of Object.entries(multiResults)) {
          if (!graph) continue;
          for (const e of (graph as any).edges ?? []) {
            const src = `${aid}:${e.source}`;
            const tgt = `${aid}:${e.target}`;
            if (nodeIds.has(src) && nodeIds.has(tgt)) {
              links.push({ source: src, target: tgt, label: e.label ?? "", weight: e.weight ?? 0.5 });
            }
          }
          // Agent hub links removed
        }
      } else {
        const graph = singleResult.data?.memoryGraph;
        if (graph) {
          for (const e of graph.edges ?? []) {
            if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
              links.push({ source: e.source, target: e.target, label: e.label ?? "", weight: e.weight ?? 0.5 });
            }
          }
        }
      }

      return { nodes: visibleNodes, links };
    }, [allNodes, matchedIds, hideFiltered, isMultiAgent, multiResults, singleResult.data]);

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
      const muted = !!node.__muted;
      const isMemory = node.nodeType === "memory";
      const entityType = node.entityType as string | null;
      const label = isMemory ? "Memory" : (entityType ? entityType.charAt(0).toUpperCase() + entityType.slice(1) : node.label?.slice(0, 12) || "Entity");
      const color = isMemory ? MEMORY_COLOR : (entityType ? (TYPE_COLORS[entityType] || ENTITY_COLOR) : ENTITY_COLOR);
      // Size by mention count (edgeCount carries mention_count from resolver)
      const mentions = node.edgeCount || 1;
      const r = isMemory ? 10 : Math.max(5, Math.min(18, 5 + Math.sqrt(mentions) * 1.5));
      const opacity = muted ? 0.15 : 1;

      const group = new THREE.Group();

      // Sphere
      const geometry = new THREE.SphereGeometry(r, 16, 16);
      const material = new THREE.MeshLambertMaterial({ color, transparent: muted, opacity });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

      // Text label via sprite
      const canvas = document.createElement("canvas");
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      const fontSize = isMemory ? 18 : 14;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = muted ? "rgba(255,255,255,0.15)" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, size / 2, size / 2);
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(r * 3, r * 3, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);

      return group;
    }, [graphData]);

    // Lock camera to top-down 2D view and set up force layout after mount
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg) return;

      // Force layout — stronger repulsion for multi-agent to prevent overlap
      const nodeCount = graphData.nodes.length;
      const chargeStrength = nodeCount > 50 ? -120 : -80;
      fg.d3Force("charge")?.strength(chargeStrength).distanceMax(200);
      fg.d3Force("link")?.distance(nodeCount > 50 ? 70 : 55);
      fg.d3Force("center")?.strength(1);
      fg.d3Force("collide", d3.forceCollide().radius(20).strength(0.8));

      // Lock camera to top-down orthographic-like view
      const camera = fg.camera();
      const controls = fg.controls();

      // Position camera looking straight down (higher = more zoomed out)
      camera.position.set(0, 0, 500);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);

      // Disable rotation, only allow pan (right-click/two-finger) and zoom
      controls.enableRotate = false;
      controls.panSpeed = 0.15;
      controls.zoomSpeed = 0.5;
      // Make left-click pan instead of rotate
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };

    }, [graphData, dims]);

    const anyFetching = isMultiAgent ? multiFetching : (singleResult.fetching && !singleResult.data);
    if (anyFetching) {
      return (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading graph...
        </div>
      );
    }

    if (!dims) {
      return (
        <div ref={containerRef} className="absolute inset-0" />
      );
    }

    if (graphData.nodes.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No knowledge graph yet. Click Dream to build one from agent memories.
          </p>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
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
          linkColor={(link: any) => link.label ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)"}
          linkWidth={(link: any) => link.label ? 2.5 : 1.5}
          linkDirectionalArrowLength={(link: any) => link.label ? 4 : 0}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(link: any) => link.label ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)"}
          linkLabel={(link: any) => link.label || ""}
          nodeLabel={(node: any) => `${node.label}${node.entityType ? ` (${node.entityType})` : ""}${node.edgeCount ? ` — ${node.edgeCount} mentions` : ""}`}
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={50}
          onNodeClick={(node: any) => {
            if (!onNodeClick) return;
            const edges = graphData.links
              .filter((l: any) => {
                const sId = typeof l.source === "object" ? l.source.id : l.source;
                const tId = typeof l.target === "object" ? l.target.id : l.target;
                return sId === node.id || tId === node.id;
              })
              .map((l: any) => {
                const sId = typeof l.source === "object" ? l.source.id : l.source;
                const tId = typeof l.target === "object" ? l.target.id : l.target;
                const otherId = sId === node.id ? tId : sId;
                const otherNode = graphData.nodes.find((n: any) => n.id === otherId);
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
          {Object.entries(TYPE_COLORS).filter(([k]) => graphData.nodes.some((n: any) => n.entityType === k)).slice(0, 6).map(([type, c]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />
              {type}
            </span>
          ))}
          {graphData.nodes.some((n: any) => !n.entityType && n.nodeType === "entity") && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: ENTITY_COLOR }} />
              Untyped
            </span>
          )}
        </div>
      </div>
    );
  },
);
