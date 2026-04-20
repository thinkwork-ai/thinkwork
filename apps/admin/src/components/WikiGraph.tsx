/**
 * WikiGraph — admin force-graph rendering compiled wiki pages and their
 * [[...]] links. Near-clone of MemoryGraph.tsx with the data source
 * swapped from Hindsight entities to wiki_pages/wiki_page_links.
 *
 * Performance patterns (in-place opacity mute on filter, one-shot camera
 * init, stable nodeThreeObject) carry over intact — each one exists to
 * avoid a camera reset or simulation restart on filter-keystrokes. Do
 * not "clean up" those without measuring.
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
import { Loader2, Sparkles } from "lucide-react";
import * as d3 from "d3-force";
import { WikiGraphQuery } from "@/lib/graphql-queries";
import {
  PAGE_TYPES,
  PAGE_TYPE_FORCE_COLORS,
  PAGE_TYPE_DEFAULT_FORCE_COLOR,
  PAGE_TYPE_LABELS,
  type WikiPageType,
} from "@/lib/wiki-palette";

export type { WikiPageType };

export interface WikiGraphNode {
  id: string;
  label: string;
  nodeType: "page";
  entityType: WikiPageType;
  slug: string;
  edgeCount: number;
  /** In multi-agent mode the node id is prefixed with `${agentId}:`; the
   *  unprefixed `pageId` and the owning `agentId` are exposed separately so
   *  the detail sheet can fetch the page without re-parsing the compound
   *  id. In single-agent mode `agentId` matches the parent-provided id. */
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
  agentId?: string;
  agentIds?: string[];
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
}

export const WikiGraph = forwardRef<WikiGraphHandle, WikiGraphProps>(
  function WikiGraph(
    { tenantId, agentId, agentIds, onNodeClick, onTypesLoaded, typeFilter, searchQuery },
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

    const isMultiAgent = !!agentIds && agentIds.length > 1;
    const client = useClient();

    // Single-agent path: urql subscription-style query.
    const [singleResult, singleReexecute] = useQuery({
      query: WikiGraphQuery,
      variables: { tenantId, ownerId: agentId ?? "" },
      pause: isMultiAgent || !agentId || !tenantId,
    });

    // Multi-agent: fan out per-agent, same shape as MemoryGraph does. One
    // round-trip per agent keeps resolver complexity flat; tenants are
    // <10 agents today.
    const [multiResults, setMultiResults] = useState<Record<string, any>>({});
    const [multiFetching, setMultiFetching] = useState(false);

    const fetchAllAgents = useCallback(async () => {
      if (!agentIds || agentIds.length === 0 || !tenantId) {
        setMultiFetching(false);
        return;
      }
      setMultiFetching(true);
      try {
        const results: Record<string, any> = {};
        await Promise.all(
          agentIds.map(async (id) => {
            try {
              const res = await client
                .query(WikiGraphQuery, { tenantId, ownerId: id })
                .toPromise();
              if (res.error) {
                console.warn(`[WikiGraph] wikiGraph failed for agent ${id}:`, res.error.message);
              }
              results[id] = res.data?.wikiGraph;
            } catch (err) {
              console.warn(`[WikiGraph] wikiGraph threw for agent ${id}:`, err);
              results[id] = { nodes: [], edges: [] };
            }
          }),
        );
        setMultiResults(results);
      } finally {
        setMultiFetching(false);
      }
    }, [agentIds, client, tenantId]);

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
      getNodeWithEdges: (nodeId: string) =>
        getNodeWithEdgesRef.current(nodeId),
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
              slug: n.slug,
              edgeCount: n.edgeCount ?? 0,
            });
          }
        }
      } else {
        const graph = singleResult.data?.wikiGraph;
        if (graph && agentId) {
          for (const n of graph.nodes ?? []) {
            nodes.push({
              id: n.id,
              pageId: n.id,
              agentId,
              label: n.label ?? n.id,
              nodeType: "page",
              entityType: (n.entityType as WikiPageType) ?? "ENTITY",
              slug: n.slug,
              edgeCount: n.edgeCount ?? 0,
            });
          }
        }
      }
      return nodes;
    }, [isMultiAgent, multiResults, singleResult.data, agentId]);

    // Surface the present type set to the parent (for a future filter UI).
    const prevTypesRef = useRef<string>("");
    useEffect(() => {
      if (!onTypesLoaded || allNodes.length === 0) return;
      const types = new Set<string>();
      for (const n of allNodes) {
        types.add(PAGE_TYPE_LABELS[n.entityType] ?? n.entityType);
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
          filterSet.has(PAGE_TYPE_LABELS[n.entityType] ?? n.entityType),
        );
      }
      if (searchQuery) {
        const normalize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const q = normalize(searchQuery);
        filtered = filtered.filter((n) => normalize(n.label).includes(q));
      }
      return new Set(filtered.map((n) => n.id));
    }, [allNodes, typeFilter, searchQuery, hasFilter]);

    // graphData rebuilds only when the raw source changes — NOT on filter.
    // Filter mute is in-place material opacity (see effect below). This
    // prevents simulation + camera reset on every keystroke.
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
                label: e.label ?? "references",
                weight: e.weight ?? 0.5,
              });
            }
          }
        }
      } else {
        const graph = singleResult.data?.wikiGraph;
        if (graph) {
          for (const e of graph.edges ?? []) {
            if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
              links.push({
                source: e.source,
                target: e.target,
                label: e.label ?? "references",
                weight: e.weight ?? 0.5,
              });
            }
          }
        }
      }
      return { nodes: allNodes, links };
    }, [allNodes, isMultiAgent, multiResults, singleResult.data]);

    const matchedIdsRef = useRef<Set<string> | null>(null);
    matchedIdsRef.current = matchedIds;

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
            targetType: otherNode?.nodeType ?? "page",
            targetId: otherId,
          };
        });
      return { node: node as WikiGraphNode, edges };
    };

    const nodeThreeObject = useCallback((node: any) => {
      const matched = matchedIdsRef.current;
      const muted = matched ? !matched.has(node.id) : false;
      const entityType = node.entityType as WikiPageType;
      const color = PAGE_TYPE_FORCE_COLORS[entityType] ?? PAGE_TYPE_DEFAULT_FORCE_COLOR;
      // Clip the label to keep the canvas readable without losing the full
      // title from the tooltip (nodeLabel callback below passes the raw
      // title to ForceGraph3D).
      const rawLabel = node.label ?? "";
      const label =
        rawLabel.length > 16 ? rawLabel.slice(0, 15) + "…" : rawLabel;
      // Size by degree. Pages with more links render bigger.
      const degree = node.edgeCount || 1;
      const r = Math.max(5, Math.min(18, 5 + Math.sqrt(degree) * 1.5));
      const opacity = muted ? 0.15 : 1;

      const group = new THREE.Group();

      const geometry = new THREE.SphereGeometry(r, 16, 16);
      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity,
      });
      const sphere = new THREE.Mesh(geometry, material);
      group.add(sphere);

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
        opacity,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(r * 3, r * 3, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);

      // Stash materials so filter-mute can adjust opacity without rebuilding
      // the graphData (which would restart the simulation).
      node.__sphereMat = material;
      node.__spriteMat = spriteMaterial;

      return group;
    }, []);

    useEffect(() => {
      for (const n of graphData.nodes as any[]) {
        const muted = matchedIds ? !matchedIds.has(n.id) : false;
        const op = muted ? 0.15 : 1;
        if (n.__sphereMat) n.__sphereMat.opacity = op;
        if (n.__spriteMat) n.__spriteMat.opacity = op;
      }
      fgRef.current?.refresh?.();
    }, [matchedIds, graphData]);

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

    // One-shot camera setup. After this the user owns zoom/pan.
    const cameraInitRef = useRef(false);
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg || !dims || cameraInitRef.current) return;
      const camera = fg.camera();
      const controls = fg.controls();
      camera.position.set(0, 0, 500);
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
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading graph...
        </div>
      );
    }

    if (!dims) {
      return <div ref={setContainerEl} className="absolute inset-0" />;
    }

    if (graphData.nodes.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground max-w-sm">
            No compiled memory pages yet — ask an agent a few questions
            and come back in a few minutes.
          </p>
        </div>
      );
    }

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
          linkColor={() => "rgba(255,255,255,0.7)"}
          linkWidth={() => 2}
          linkDirectionalArrowLength={() => 4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={() => "rgba(255,255,255,0.7)"}
          linkLabel={(link: any) => link.label || "references"}
          nodeLabel={(node: any) =>
            `${node.label}${
              node.entityType
                ? ` (${PAGE_TYPE_LABELS[node.entityType as WikiPageType] ?? node.entityType})`
                : ""
            }${node.edgeCount ? ` — ${node.edgeCount} link${node.edgeCount === 1 ? "" : "s"}` : ""}`
          }
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
                const otherNode = graphData.nodes.find(
                  (n: any) => n.id === otherId,
                );
                return {
                  label: l.label || "references",
                  targetLabel: otherNode?.label ?? otherId,
                  targetType: otherNode?.nodeType ?? "page",
                  targetId: otherId,
                };
              });
            onNodeClick(node as WikiGraphNode, edges);
          }}
          onNodeDragEnd={(node: any) => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
          }}
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
