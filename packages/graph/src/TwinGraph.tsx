/**
 * TwinGraph — 2D force-graph of one twin entity's neighborhood
 * (THINK-327 U3).
 *
 * Self-fetching sibling of KnowledgeGraph/MemoryGraph/WikiGraph/
 * OntologyGraph per the settled convention (Living Map KTD-1): new surface,
 * new sibling — never a modification of an existing component's fetch seam
 * or sim/camera behavior. Fetches `twinNeighbors` (AWSJSON envelope
 * `{ ok, results: [{ node, neighbors, edges }] }`), maps Neptune openCypher
 * nodes onto the settled node shape (label = displayName, type badge from
 * `~labels`), and labels edges by relationship type.
 *
 * Camera invariants (sibling parity): one-shot zoomToFit after the first
 * settle; depth-change refetches merge nodes IN PLACE by id so surviving
 * nodes keep their positions and the camera never re-frames.
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
import { TwinNeighborsQuery } from "./queries.js";
import {
  degreeRadius,
  endpointId,
  labelsVisibleAtScale,
  wrapLabelLines,
} from "./graph-utils.js";

export interface TwinGraphNode {
  /** The Neptune `~id` (`t#<tenant>#e#<canonicalId>`). */
  id: string;
  /** The canonical id parsed from the `~id`; null if the prefix is foreign. */
  canonicalId: string | null;
  label: string;
  /** Entity type from the node's `~labels`. */
  typeLabel: string | null;
  isCenter: boolean;
}

export interface TwinGraphLink {
  id: string;
  source: string | { id: string };
  target: string | { id: string };
  label: string;
}

export interface TwinGraphData {
  nodes: TwinGraphNode[];
  links: TwinGraphLink[];
}

export interface TwinGraphHandle {
  refetch: () => void;
}

const CENTER_COLOR = "#0ea5e9";
const NEIGHBOR_COLOR = "#64748b";

/** `t#<tenant>#e#<canonicalId>` → canonicalId. */
export function twinCanonicalIdFromNodeId(nodeId: string): string | null {
  const match = /^t#[^#]+#e#(.+)$/.exec(nodeId);
  return match ? match[1]! : null;
}

function parseAwsJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function mapNeptuneNode(raw: unknown, isCenter: boolean): TwinGraphNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const id = node["~id"];
  if (typeof id !== "string" || !id) return null;
  const labels = Array.isArray(node["~labels"]) ? node["~labels"] : [];
  const typeLabel = typeof labels[0] === "string" ? labels[0] : null;
  const properties =
    node["~properties"] && typeof node["~properties"] === "object"
      ? (node["~properties"] as Record<string, unknown>)
      : {};
  const canonicalId = twinCanonicalIdFromNodeId(id);
  const displayName = properties.displayName;
  return {
    id,
    canonicalId,
    label:
      typeof displayName === "string" && displayName
        ? displayName
        : (canonicalId ?? id),
    typeLabel,
    isCenter,
  };
}

/** Project the twinNeighbors payload into force-graph nodes/links. */
export function buildTwinGraphData(payload: unknown): TwinGraphData {
  const envelope = parseAwsJson(payload);
  if (!envelope || envelope.ok !== true) return { nodes: [], links: [] };
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  const row = (results[0] ?? {}) as Record<string, unknown>;

  const nodes: TwinGraphNode[] = [];
  const seen = new Set<string>();
  const center = mapNeptuneNode(row.node, true);
  if (center) {
    nodes.push(center);
    seen.add(center.id);
  }
  for (const neighbor of Array.isArray(row.neighbors) ? row.neighbors : []) {
    const mapped = mapNeptuneNode(neighbor, false);
    if (mapped && !seen.has(mapped.id)) {
      nodes.push(mapped);
      seen.add(mapped.id);
    }
  }

  const links: TwinGraphLink[] = [];
  const linkIds = new Set<string>();
  for (const edge of Array.isArray(row.edges) ? row.edges : []) {
    if (!edge || typeof edge !== "object") continue;
    const { rel, sourceId, targetId } = edge as Record<string, unknown>;
    if (
      typeof rel !== "string" ||
      typeof sourceId !== "string" ||
      typeof targetId !== "string"
    ) {
      continue;
    }
    // Both endpoints must be on the canvas (the neighbor list is capped).
    if (!seen.has(sourceId) || !seen.has(targetId)) continue;
    const id = `${rel}:${sourceId}->${targetId}`;
    if (linkIds.has(id)) continue;
    linkIds.add(id);
    links.push({ id, source: sourceId, target: targetId, label: rel });
  }
  return { nodes, links };
}

/**
 * In-place merge (sibling R17 discipline): surviving node/link objects keep
 * their identity — and therefore their simulation positions — across
 * depth-change refetches, so the camera never re-frames.
 */
export function mergeTwinGraphData(
  target: TwinGraphData,
  payload: unknown,
): void {
  const next = buildTwinGraphData(payload);
  const nodeById = new Map(target.nodes.map((node) => [node.id, node]));
  const mergedNodes = next.nodes.map((node) => {
    const existing = nodeById.get(node.id);
    if (!existing) return node;
    existing.label = node.label;
    existing.typeLabel = node.typeLabel;
    existing.isCenter = node.isCenter;
    return existing;
  });
  target.nodes.splice(0, target.nodes.length, ...mergedNodes);

  const linkById = new Map(target.links.map((link) => [link.id, link]));
  const mergedLinks = next.links.map((link) => linkById.get(link.id) ?? link);
  target.links.splice(0, target.links.length, ...mergedLinks);
}

export interface TwinGraphProps {
  tenantId: string;
  canonicalId: string;
  /** Neighborhood depth (compiler-bounded 1..2). Default 1. */
  depth?: number;
  /**
   * Node click, with the canonical id parsed from the `~id` — the host
   * decides navigation (component stays router-agnostic). Not fired for
   * nodes whose id doesn't parse.
   */
  onNodeClick?: (node: TwinGraphNode) => void;
  loadingFallback?: React.ReactNode;
  emptyFallback?: React.ReactNode;
  errorFallback?: (message: string, retry: () => void) => React.ReactNode;
}

export const TwinGraph = forwardRef<TwinGraphHandle, TwinGraphProps>(
  function TwinGraph(
    {
      tenantId,
      canonicalId,
      depth = 1,
      onNodeClick,
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
      query: TwinNeighborsQuery,
      variables: { tenantId, canonicalId, depth },
      pause: !tenantId || !canonicalId,
    });
    const refetch = useCallback(
      () => reexecute({ requestPolicy: "network-only" }),
      [reexecute],
    );
    useImperativeHandle(ref, () => ({ refetch }), [refetch]);

    // Stable container mutated in place; the engine gets a fresh shallow
    // wrapper per merge so it re-ingests without a layout restart.
    const graphDataRef = useRef<TwinGraphData>({ nodes: [], links: [] });
    const lastKeyRef = useRef<string | null>(null);
    const payload = result.data?.twinNeighbors ?? null;
    const graphKey =
      payload === null
        ? null
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload);
    if (graphKey !== null && graphKey !== lastKeyRef.current) {
      lastKeyRef.current = graphKey;
      mergeTwinGraphData(graphDataRef.current, payload);
    }
    const engineData = useMemo(
      () => ({
        nodes: graphDataRef.current.nodes,
        links: graphDataRef.current.links,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [graphKey],
    );
    const graphData = graphDataRef.current;

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

    const zoomKRef = useRef(1);
    const nodeCountRef = useRef(0);
    nodeCountRef.current = graphData.nodes.length;

    const nodeCanvasObject = useCallback(
      (node: any, ctx: CanvasRenderingContext2D) => {
        const r = node.isCenter ? 10 : degreeRadius(1, 2);
        const color = node.isCenter ? CENTER_COLOR : NEIGHBOR_COLOR;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        if (labelsVisibleAtScale(zoomKRef.current, nodeCountRef.current)) {
          const fontSize = Math.max(3.5, r * 0.4);
          ctx.font = `600 ${fontSize}px sans-serif`;
          const lines = wrapLabelLines(
            (s) => ctx.measureText?.(s)?.width ?? s.length * fontSize * 0.6,
            node.label ?? "",
            r * 3,
            2,
          );
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "#94a3b8";
          lines.forEach((line, index) => {
            ctx.fillText(
              line,
              node.x,
              node.y + r + 2 + index * fontSize * 1.15,
            );
          });
        }
      },
      [],
    );

    const zoomInitRef = useRef(false);

    if (result.fetching && !result.data) {
      return (
        loadingFallback ?? (
          <div
            data-testid="twin-graph-loading"
            className="flex h-full min-h-48 items-center justify-center py-16"
          >
            <div className="flex items-center gap-3 animate-pulse">
              <span className="inline-block h-4 w-4 rounded-full bg-muted" />
              <span className="inline-block h-3 w-40 rounded bg-muted" />
              <span className="sr-only">Loading neighborhood...</span>
            </div>
          </div>
        )
      );
    }

    if (result.error && graphData.nodes.length === 0) {
      return (
        errorFallback?.(result.error.message, refetch) ?? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">Neighborhood could not load.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {result.error.message}
            </p>
            <button
              type="button"
              className="mt-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={refetch}
            >
              Retry
            </button>
          </div>
        )
      );
    }

    if (!dims) {
      return <div ref={setContainerEl} className="absolute inset-0" />;
    }

    if (graphData.nodes.length <= 1) {
      return (
        emptyFallback ?? (
          <div
            data-testid="twin-graph-empty"
            className="flex flex-col items-center gap-2 py-16 text-center"
          >
            <p className="max-w-sm text-sm text-muted-foreground">
              No connected entities yet.
            </p>
          </div>
        )
      );
    }

    return (
      <div
        ref={setContainerEl}
        data-testid="twin-graph-container"
        className="absolute inset-0 overflow-hidden"
      >
        <ForceGraph2D
          ref={fgRef}
          graphData={engineData}
          width={dims.w}
          height={dims.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={nodeCanvasObject}
          nodeLabel={(node: any) =>
            `${node.label}${node.typeLabel ? ` — ${node.typeLabel}` : ""}`
          }
          linkLabel={(link: any) => link.label || "related to"}
          linkColor={() => "rgba(148,163,184,0.4)"}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={120}
          onNodeClick={(node: any) => {
            if (node?.canonicalId) onNodeClick?.(node as TwinGraphNode);
          }}
          onZoom={({ k }: { k: number }) => {
            zoomKRef.current = k;
          }}
          onEngineStop={() => {
            // One-shot framing: depth-change merges never re-frame.
            if (zoomInitRef.current) return;
            zoomInitRef.current = true;
            fgRef.current?.zoomToFit?.(0, 30);
          }}
        />
      </div>
    );
  },
);

// endpointId re-exported use keeps parity with sibling helpers for hosts
// that need to resolve link endpoints (tests included).
export { endpointId as twinGraphEndpointId };
