/**
 * TwinGraph — 2D force-graph of the digital twin (THINK-327 U3, rebuilt on
 * the shared renderer core for the traversal explorer).
 *
 * Rendering and interaction come from `renderer-core` + `useGraphPointer`
 * — the SAME paint geometry and geometric hit-testing the Memory tab uses
 * (in-disc wrapped labels, inline rotated edge labels, degree-scaled
 * discs, no canvas color-picking, so clicks work under Brave/Firefox
 * fingerprint farbling). Every node class reports clicks — there is no
 * canonicalId guard; hosts decide what a click means.
 *
 * Data modes:
 *  - neighbors (canonicalId) / type-overview (subgraphEntityTypes): the
 *    original self-fetching seams, unchanged.
 *  - controlled (`data` + `revision`): the traversal explorer supplies
 *    merged graph data and owns all click routing; no fetching happens.
 *
 * Camera: frame ONCE, early in the settle (~tick 15) and never again — no
 * end-of-settle zoom snap (Eric, 2026-07-22). Data merges keep node object
 * identity (`mergeTwinGraphData`) so the camera never re-frames.
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
import * as d3 from "d3-force";
import { useClient, useQuery } from "urql";
import { TwinNeighborsQuery, TwinSubgraphQuery } from "./queries.js";
import {
  degreeRadius,
  endpointId,
  labelsVisibleAtScale,
} from "./graph-utils.js";
import {
  makeEarlyTickFramer,
  paintLinkLine,
  paintNodeDisc,
} from "./renderer-core.js";
import { useGraphPointer } from "./use-graph-pointer.js";

export interface TwinGraphNode {
  /** The Neptune `~id` (`t#<tenant>#e#<canonicalId>`). */
  id: string;
  /** The canonical id parsed from the `~id`; null if the prefix is foreign. */
  canonicalId: string | null;
  label: string;
  /** Entity type from the node's `~labels`. */
  typeLabel: string | null;
  /** External-system node (`t#<tenant>#sys#<slug>`) — not navigable. */
  isSystem: boolean;
  isCenter: boolean;
  /** The node's flat property map (facet stamps included) — the host's
   *  property side sheet renders these. */
  properties: Record<string, unknown>;
  /**
   * Synthetic traversal nodes (summary / "+N more…" / "(no relations)")
   * set a kind; real twin entities leave it undefined.
   */
  kind?: "summary" | "more" | "none";
  /** Explicit paint overrides for synthetic nodes. */
  color?: string;
  radius?: number;
  /** Bypass the zoom label gate — summary counts must always read. */
  labelAlways?: boolean;
  /** In-flight fetch affordance: painted dimmed. */
  pending?: boolean;
}

export interface TwinGraphLink {
  id: string;
  source: string | { id: string };
  target: string | { id: string };
  label: string;
  /** Relationship properties for the side sheet (may be empty). */
  properties: Record<string, unknown>;
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
const SYSTEM_COLOR = "#a78bfa";

/** Stable per-entity-type hues so dense neighborhoods read as data, not
 * uniform gray blobs — hash the type label into a small curated palette. */
const TYPE_PALETTE = [
  "#2dd4bf", // teal
  "#f59e0b", // amber
  "#818cf8", // indigo
  "#f472b6", // pink
  "#4ade80", // green
  "#fb923c", // orange
  "#38bdf8", // sky
  "#e879f9", // fuchsia
  "#a3e635", // lime
  "#f87171", // red
];
/** Every node renders the same size — density reads through color and
 * position, not radius. */
export const TWIN_NODE_RADIUS = 6;

export function twinTypeColor(typeLabel: string | null): string {
  if (!typeLabel) return NEIGHBOR_COLOR;
  let hash = 0;
  for (let i = 0; i < typeLabel.length; i += 1) {
    hash = (hash * 31 + typeLabel.charCodeAt(i)) | 0;
  }
  return TYPE_PALETTE[Math.abs(hash) % TYPE_PALETTE.length]!;
}

/** `t#<tenant>#e#<canonicalId>` → canonicalId. */
export function twinCanonicalIdFromNodeId(nodeId: string): string | null {
  const match = /^t#[^#]+#e#(.+)$/.exec(nodeId);
  return match ? match[1]! : null;
}

/** `t#<tenant>#sys#<systemSlug>` → systemSlug (external-system nodes). */
export function twinSystemSlugFromNodeId(nodeId: string): string | null {
  const match = /^t#[^#]+#sys#(.+)$/.exec(nodeId);
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

/** Map one Neptune openCypher node payload onto the settled node shape
 * (exported for the traversal explorer's member-batch parsing). */
export function mapNeptuneNode(
  raw: unknown,
  isCenter: boolean,
): TwinGraphNode | null {
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
  const systemSlug = twinSystemSlugFromNodeId(id);
  const displayName = properties.displayName;
  return {
    id,
    canonicalId,
    label:
      typeof displayName === "string" && displayName
        ? displayName
        : (canonicalId ?? systemSlug ?? id),
    typeLabel: systemSlug ? "system" : typeLabel,
    isSystem: systemSlug !== null,
    isCenter,
    properties,
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
  const roots = Array.isArray(row.roots)
    ? row.roots
    : row.node !== undefined
      ? [row.node]
      : [];
  for (const root of roots) {
    const center = mapNeptuneNode(root, true);
    if (center && !seen.has(center.id)) {
      nodes.push(center);
      seen.add(center.id);
    }
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
  const addLink = (
    rel: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown>,
  ) => {
    // Both endpoints must be on the canvas (the neighbor list is capped).
    if (!seen.has(sourceId) || !seen.has(targetId)) return;
    const id = `${rel}:${sourceId}->${targetId}`;
    if (linkIds.has(id)) return;
    linkIds.add(id);
    links.push({
      id,
      source: sourceId,
      target: targetId,
      label: rel,
      properties,
    });
  };
  for (const edge of Array.isArray(row.edges) ? row.edges : []) {
    if (!edge || typeof edge !== "object") continue;
    const { rel, sourceId, targetId, props } = edge as Record<string, unknown>;
    if (
      typeof rel !== "string" ||
      typeof sourceId !== "string" ||
      typeof targetId !== "string"
    ) {
      continue;
    }
    addLink(
      rel,
      sourceId,
      targetId,
      props && typeof props === "object"
        ? (props as Record<string, unknown>)
        : {},
    );
  }
  // Subgraph payloads return whole paths — arrays of alternating
  // node/relationship objects; relationships carry ~start/~end/~type.
  for (const path of Array.isArray(row.paths) ? row.paths : []) {
    if (!Array.isArray(path)) continue;
    for (const element of path) {
      if (!element || typeof element !== "object") continue;
      const record = element as Record<string, unknown>;
      if (record["~entityType"] !== "relationship") continue;
      const relType = record["~type"];
      const start = record["~start"];
      const end = record["~end"];
      if (
        typeof relType !== "string" ||
        typeof start !== "string" ||
        typeof end !== "string"
      ) {
        continue;
      }
      addLink(
        relType,
        start,
        end,
        record["~properties"] && typeof record["~properties"] === "object"
          ? (record["~properties"] as Record<string, unknown>)
          : {},
      );
    }
  }
  return { nodes, links };
}

/** Union several subgraph payloads (multi-type overview) by node/link id. */
export function combineTwinGraphData(payloads: unknown[]): TwinGraphData {
  const nodes: TwinGraphNode[] = [];
  const links: TwinGraphLink[] = [];
  const nodeIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const payload of payloads) {
    const part = buildTwinGraphData(payload);
    for (const node of part.nodes) {
      if (nodeIds.has(node.id)) continue;
      nodeIds.add(node.id);
      nodes.push(node);
    }
    for (const link of part.links) {
      if (linkIds.has(link.id)) continue;
      linkIds.add(link.id);
      links.push(link);
    }
  }
  return { nodes, links };
}

/**
 * In-place merge (sibling R17 discipline): surviving node/link objects keep
 * their identity — and therefore their simulation positions — across
 * depth-change refetches, so the camera never re-frames. Accepts one raw
 * payload or an array of them (multi-type overview).
 */
export function mergeTwinGraphData(
  target: TwinGraphData,
  payload: unknown,
): void {
  const next = Array.isArray(payload)
    ? combineTwinGraphData(payload)
    : buildTwinGraphData(payload);
  const nodeById = new Map(target.nodes.map((node) => [node.id, node]));
  const mergedNodes = next.nodes.map((node) => {
    const existing = nodeById.get(node.id);
    if (!existing) return node;
    existing.label = node.label;
    existing.typeLabel = node.typeLabel;
    existing.isCenter = node.isCenter;
    existing.properties = node.properties;
    return existing;
  });
  target.nodes.splice(0, target.nodes.length, ...mergedNodes);

  const linkById = new Map(target.links.map((link) => [link.id, link]));
  const mergedLinks = next.links.map((link) => linkById.get(link.id) ?? link);
  target.links.splice(0, target.links.length, ...mergedLinks);
}

export interface TwinGraphProps {
  tenantId: string;
  /** Entity-neighborhood mode: the entity whose neighborhood renders. */
  canonicalId?: string;
  /**
   * Type-overview mode (Explorer graph view): a bounded per-type sample of
   * instances + neighborhoods, unioned across the listed types. Used when
   * `canonicalId` is absent.
   */
  subgraphEntityTypes?: string[];
  /** Root sample size for type-overview mode (compiler-capped at 25). */
  subgraphLimit?: number;
  /** Neighborhood depth (compiler-bounded 1..2). Default 1. */
  depth?: number;
  /**
   * Controlled traversal mode: the host supplies merged graph data
   * (mutated in place, `mergeTwinGraphData` discipline) and bumps
   * `revision` after each merge. No fetching happens in this mode; the
   * host owns click routing and emptiness.
   */
  data?: TwinGraphData;
  revision?: number;
  /**
   * Node click — fires for EVERY node class (entity, system, synthetic);
   * the host decides what a click means. Component stays router-agnostic.
   */
  onNodeClick?: (node: TwinGraphNode) => void;
  /** Double-click (useGraphPointer primitive) — entity detail, typically. */
  onNodeDoubleClick?: (node: TwinGraphNode) => void;
  /** Edge click — the host renders the relationship's property sheet. */
  onLinkClick?: (link: TwinGraphLink) => void;
  onBackgroundClick?: () => void;
  loadingFallback?: React.ReactNode;
  emptyFallback?: React.ReactNode;
  errorFallback?: (message: string, retry: () => void) => React.ReactNode;
}

export const TwinGraph = forwardRef<TwinGraphHandle, TwinGraphProps>(
  function TwinGraph(
    {
      tenantId,
      canonicalId,
      subgraphEntityTypes,
      subgraphLimit,
      depth = 1,
      data: controlledData,
      revision = 0,
      onNodeClick,
      onNodeDoubleClick,
      onLinkClick,
      onBackgroundClick,
      loadingFallback,
      emptyFallback,
      errorFallback,
    },
    ref,
  ) {
    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
    const fgRef = useRef<any>(null);
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

    const controlled = controlledData !== undefined;
    const overviewTypes = useMemo(
      () =>
        controlled || canonicalId
          ? []
          : (subgraphEntityTypes ?? []).filter(Boolean),
      [controlled, canonicalId, subgraphEntityTypes],
    );
    const overviewMode = overviewTypes.length > 0;
    const client = useClient();

    // Neighbors mode keeps the plain useQuery; overview fans one subgraph
    // query out per selected type and unions the payloads. Controlled mode
    // never fetches.
    const [neighborsResult, reexecute] = useQuery({
      query: TwinNeighborsQuery,
      variables: { tenantId, canonicalId, depth },
      pause: controlled || !tenantId || !canonicalId,
    });
    const [overview, setOverview] = useState<{
      key: string;
      fetching: boolean;
      error: string | null;
      payloads: unknown[] | null;
    }>({ key: "", fetching: false, error: null, payloads: null });
    const overviewKey = overviewMode
      ? JSON.stringify([tenantId, overviewTypes, subgraphLimit, depth])
      : "";
    const overviewGenRef = useRef(0);
    const fetchOverview = useCallback(() => {
      if (!overviewMode) return;
      const generation = ++overviewGenRef.current;
      setOverview({
        key: overviewKey,
        fetching: true,
        error: null,
        payloads: null,
      });
      void Promise.all(
        overviewTypes.map((entityType) =>
          client
            .query(
              TwinSubgraphQuery,
              { tenantId, entityType, limit: subgraphLimit, depth },
              { requestPolicy: "network-only" },
            )
            .toPromise(),
        ),
      ).then((results) => {
        if (generation !== overviewGenRef.current) return;
        const firstError = results.find((r) => r.error)?.error;
        setOverview({
          key: overviewKey,
          fetching: false,
          error: firstError ? firstError.message : null,
          payloads: results.map(
            (r) => (r.data as { twinSubgraph?: unknown })?.twinSubgraph ?? null,
          ),
        });
      });
      // `client` is render-stable from the urql Provider — kept out of the
      // deps so test doubles can't loop the effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overviewMode, overviewKey]);
    useEffect(() => {
      if (overviewMode) fetchOverview();
    }, [overviewMode, fetchOverview]);

    const refetch = useCallback(() => {
      if (overviewMode) fetchOverview();
      else reexecute({ requestPolicy: "network-only" });
    }, [overviewMode, fetchOverview, reexecute]);
    useImperativeHandle(ref, () => ({ refetch }), [refetch]);

    // Stable container mutated in place; the engine gets a fresh shallow
    // wrapper per merge so it re-ingests without a layout restart.
    const graphDataRef = useRef<TwinGraphData>({ nodes: [], links: [] });
    const lastKeyRef = useRef<string | null>(null);

    // The query identity (mode + types + entity): when it changes, the old
    // dataset is WRONG, not stale-but-refreshing — drop it immediately so
    // the loading state shows instead of the previous type's nodes, and
    // re-frame the camera for the next dataset. Applies to the self-fetch
    // modes only — in controlled mode the HOST owns replacement (remount
    // via key to re-frame).
    const identityKey = controlled
      ? "controlled"
      : overviewMode
        ? overviewKey
        : JSON.stringify([tenantId, canonicalId]);
    const framerRef = useRef<(() => void) | null>(null);
    const identityRef = useRef<string | null>(null);
    if (identityRef.current !== identityKey) {
      identityRef.current = identityKey;
      graphDataRef.current.nodes.length = 0;
      graphDataRef.current.links.length = 0;
      lastKeyRef.current = null;
      // Fresh dataset → fresh one-shot early-tick framing (never re-frames
      // on merges within the same identity).
      framerRef.current = makeEarlyTickFramer(fgRef);
    }

    let graphKey: string | null;
    if (controlled) {
      graphKey = `controlled:${revision}`;
    } else {
      const payload = overviewMode
        ? overview.key === overviewKey
          ? overview.payloads
          : null
        : (neighborsResult.data?.twinNeighbors ?? null);
      graphKey =
        payload === null
          ? null
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload);
      if (graphKey !== null && graphKey !== lastKeyRef.current) {
        lastKeyRef.current = graphKey;
        mergeTwinGraphData(graphDataRef.current, payload);
      }
    }
    const engineData = useMemo(
      () =>
        controlled
          ? { nodes: controlledData!.nodes, links: controlledData!.links }
          : {
              nodes: graphDataRef.current.nodes,
              links: graphDataRef.current.links,
            },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [graphKey, controlled, controlledData],
    );
    const graphData = controlled ? controlledData! : graphDataRef.current;
    const engineDataRef = useRef(engineData);
    engineDataRef.current = engineData;

    // Degree-scaled discs (renderer-core parity with the Memory tab):
    // normalize against this dataset's max degree; synthetic nodes may
    // carry an explicit radius.
    const degreeById = useMemo(() => {
      const degrees = new Map<string, number>();
      for (const link of engineData.links) {
        const s = endpointId(link.source as never);
        const t = endpointId(link.target as never);
        degrees.set(s, (degrees.get(s) ?? 0) + 1);
        degrees.set(t, (degrees.get(t) ?? 0) + 1);
      }
      return degrees;
    }, [engineData]);
    const maxDegree = useMemo(
      () => Math.max(1, ...degreeById.values()),
      [degreeById],
    );
    const degreeRef = useRef({ degreeById, maxDegree });
    degreeRef.current = { degreeById, maxDegree };
    const nodeRadius = useCallback((node: any) => {
      if (typeof node.radius === "number") return node.radius;
      const { degreeById: degrees, maxDegree: max } = degreeRef.current;
      return degreeRadius(degrees.get(node.id) ?? 1, max);
    }, []);

    // Dense neighborhoods (invoices/items fanning out of one customer)
    // otherwise stack into a single blob. Firm collision + wider link
    // distance keeps nodes separated, and every data merge reheats the
    // simulation so the layout actually updates.
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg || typeof fg.d3Force !== "function") return;
      fg.d3Force(
        "collide",
        d3
          .forceCollide()
          .radius((node: any) => nodeRadius(node) + 6)
          .strength(1)
          .iterations(2),
      );
      // Weak centering keeps the many disconnected star-clusters of a
      // 1-hop overview gathered instead of repelling into a sparse
      // starfield at the canvas corners.
      fg.d3Force("x", d3.forceX(0).strength(0.1));
      fg.d3Force("y", d3.forceY(0).strength(0.1));
      fg.d3Force("charge")?.strength?.(-40);
      fg.d3Force("link")?.distance?.(40);
      fg.d3ReheatSimulation?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graphKey, dims]);

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
    const dimsRef = useRef(dims);
    dimsRef.current = dims;

    // Renderer-core painting — identical geometry to the Memory tab:
    // in-disc wrapped labels, rim, zoom-gated visibility.
    const nodeCanvasObject = useCallback(
      (node: any, ctx: CanvasRenderingContext2D) => {
        const color =
          node.color ??
          (node.isCenter
            ? CENTER_COLOR
            : node.isSystem
              ? SYSTEM_COLOR
              : twinTypeColor(node.typeLabel));
        paintNodeDisc(node, ctx, {
          radius: nodeRadius(node),
          color,
          alpha: node.pending ? 0.5 : 1,
          label:
            node.labelAlways ||
            labelsVisibleAtScale(zoomKRef.current, nodeCountRef.current)
              ? (node.label ?? "")
              : null,
        });
      },
      [nodeRadius],
    );

    const linkCanvasObject = useCallback(
      (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const start = link.source;
        const end = link.target;
        if (typeof start !== "object" || typeof end !== "object") return;
        paintLinkLine(link, ctx, globalScale, {
          sourceRadius: nodeRadius(start),
          targetRadius: nodeRadius(end),
          color: "rgba(148,163,184,0.9)",
          label:
            (link as { labelAlways?: boolean }).labelAlways ||
            labelsVisibleAtScale(zoomKRef.current, nodeCountRef.current)
              ? link.label || "related to"
              : null,
          viewport: dimsRef.current,
        });
      },
      [nodeRadius],
    );

    // Geometric pointer handling — replaces the library's canvas-picking
    // (broken under Brave/Firefox fingerprinting protection) AND removes
    // the old canonicalId click guard: every node class reports clicks.
    const { tooltip } = useGraphPointer({
      containerEl,
      fgRef,
      graphDataRef: engineDataRef,
      nodeRadius,
      tooltipText: (node: any) =>
        `${node.label}${node.typeLabel ? ` — ${node.typeLabel}` : ""}`,
      onNodeClick: (node: any) => onNodeClick?.(node as TwinGraphNode),
      onNodeDoubleClick: onNodeDoubleClick
        ? (node: any) => onNodeDoubleClick(node as TwinGraphNode)
        : undefined,
      onLinkClick: onLinkClick
        ? (link: any) => onLinkClick(link as TwinGraphLink)
        : undefined,
      onBackgroundClick: () => onBackgroundClick?.(),
    });

    const fetching = controlled
      ? false
      : overviewMode
        ? overview.fetching || overview.key !== overviewKey
        : neighborsResult.fetching;
    const errorMessage = controlled
      ? null
      : overviewMode
        ? overview.error
        : (neighborsResult.error?.message ?? null);

    if (fetching && graphData.nodes.length === 0) {
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

    if (errorMessage && graphData.nodes.length === 0) {
      return (
        errorFallback?.(errorMessage, refetch) ?? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">
              {overviewMode
                ? "Graph could not load."
                : "Neighborhood could not load."}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {errorMessage}
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

    // The self-fetch modes' emptiness; a controlled host owns emptiness
    // (a lone traversal root must render, not blank the canvas).
    if (!controlled && graphData.nodes.length <= 1) {
      return (
        emptyFallback ?? (
          <div
            data-testid="twin-graph-empty"
            className="flex h-full min-h-48 flex-col items-center justify-center gap-2 py-16 text-center"
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
          // Continuous repaint so ref-driven zoom/label changes show
          // without rebuilding graphData (Memory-tab discipline).
          autoPauseRedraw={false}
          enablePointerInteraction={false}
          linkCanvasObjectMode={() => "replace" as const}
          linkCanvasObject={linkCanvasObject}
          cooldownTicks={120}
          onZoom={({ k }: { k: number }) => {
            zoomKRef.current = k;
          }}
          onEngineTick={() => framerRef.current?.()}
        />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md whitespace-nowrap backdrop-blur-sm"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    );
  },
);

// endpointId re-exported use keeps parity with sibling helpers for hosts
// that need to resolve link endpoints (tests included).
export { endpointId as twinGraphEndpointId };
