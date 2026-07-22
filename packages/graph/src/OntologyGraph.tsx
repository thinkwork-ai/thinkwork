/**
 * OntologyGraph — 2D force-graph rendering the tenant's ontology schema
 * graph (THINK-320 Living Map, U5).
 *
 * Self-fetching sibling of KnowledgeGraph/WikiGraph/MemoryGraph (KTD-1):
 * approved entity types render as solid discs sized by live instance count,
 * approved relationship types as labeled edges, and pending change-set
 * items as dashed-ring "ghost" candidates carrying an evidence badge (R1,
 * R2). Candidate relationship items whose endpoint types both exist render
 * as dashed ghost edges instead of ghost nodes.
 *
 * Canvas invariants (R3/R17 — load-bearing, see
 * docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md):
 *   - Filtering and focus dim in place via the painters; no interaction
 *     rebuilds graphData, re-registers forces, or resets the camera.
 *   - Live candidate arrival merges by stable id with IN-PLACE mutation of
 *     the existing graphData arrays. The arrays and every surviving
 *     node/link object keep their identity across refetches so the d3
 *     simulation never restarts (`mergeOntologyGraphData`); a fresh shallow
 *     engine container per merge is what makes the react wrapper re-ingest
 *     arrivals at all (its ref exposes no graphData setter).
 *   - At most ONTOLOGY_GHOST_CANDIDATE_CAP ghost candidates render at once
 *     (R18); overflow is enforced at data-merge time and surfaced to the
 *     review rail via `onCandidateOverflow`.
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
import { OntologyGraphQuery } from "./queries.js";
import {
  classifyNode,
  composeGraphClassification,
  darkenColor,
  degreeRadius,
  endpointId,
  expandNeighborhood,
  labelsVisibleAtScale,
  normalizeGraphSearch,
  wrapLabelLines,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
  type GraphClassification,
  type GraphEndpoint,
  type GraphFocusState,
  type LabelMode,
} from "./graph-utils.js";
import { GraphLabelToggles } from "./GraphLabelToggles.js";
import { useGraphPointer } from "./use-graph-pointer.js";

/** R18: hard cap on ghost candidates rendered on the canvas at once. */
export const ONTOLOGY_GHOST_CANDIDATE_CAP = 30;

export type OntologyGraphNodeKind = "type" | "candidate" | "system";

export interface OntologyGraphNode {
  id: string;
  kind: OntologyGraphNodeKind;
  slug: string | null;
  label: string;
  /** Live instance count (approved types; 0 for candidates). */
  instanceCount: number;
  /** Evidence backing a candidate (0 for approved types). */
  evidenceCount: number;
  lifecycleStatus: string | null;
  /** Change-set item linkage — null for approved types. */
  itemId: string | null;
  changeSetId: string | null;
  itemType: string | null;
  origin: string | null;
}

export interface OntologyGraphLink {
  id: string;
  kind: "relationship" | "candidate" | "system";
  source: GraphEndpoint;
  target: GraphEndpoint;
  label: string;
  slug: string | null;
  itemId: string | null;
  changeSetId: string | null;
  evidenceCount: number;
  /**
   * Quadratic-bezier curvature (react-force-graph model: control point sits
   * perpendicular to the segment midpoint at curvature*length). 0 = straight.
   * Assigned by `assignOntologyLinkCurvatures` so parallel/bidirectional
   * links between the same node pair fan out instead of overprinting.
   */
  curvature: number;
}

export interface OntologyGraphData {
  nodes: OntologyGraphNode[];
  links: OntologyGraphLink[];
}

export interface OntologyGraphHandle {
  refetch: () => void;
}

/**
 * Facet filters dimming non-matching nodes in place (R3 — same treatment
 * as search/focus; never removes nodes or restarts the simulation):
 *   - status: "approved" (solid types) / "proposed" (ghost candidates)
 *   - origin: candidate change-set provenance (suggestion_engine, user, ...)
 *   - evidence: "has_evidence" / "none" (candidate evidence backing)
 *   - activity: "has_instances" / "empty" (live instance counts)
 */
export interface OntologyGraphFilters {
  statusFilter?: string[];
  originFilter?: string[];
  evidenceFilter?: string[];
  activityFilter?: string[];
}

/** Pure node predicate behind the facet filters (empty/omitted = match). */
export function ontologyNodeMatchesFilters(
  node: OntologyGraphNode,
  {
    statusFilter,
    originFilter,
    evidenceFilter,
    activityFilter,
  }: OntologyGraphFilters,
): boolean {
  if (
    statusFilter &&
    statusFilter.length > 0 &&
    !statusFilter.includes(node.kind === "candidate" ? "proposed" : "approved")
  ) {
    return false;
  }
  if (
    originFilter &&
    originFilter.length > 0 &&
    !(node.origin != null && originFilter.includes(node.origin))
  ) {
    return false;
  }
  if (
    evidenceFilter &&
    evidenceFilter.length > 0 &&
    !evidenceFilter.includes(node.evidenceCount > 0 ? "has_evidence" : "none")
  ) {
    return false;
  }
  if (
    activityFilter &&
    activityFilter.length > 0 &&
    !activityFilter.includes(node.instanceCount > 0 ? "has_instances" : "empty")
  ) {
    return false;
  }
  return true;
}

interface OntologyGraphProps extends OntologyGraphFilters {
  tenantId: string;
  searchQuery?: string;
  /**
   * Fires with the distinct candidate origins present in the data (sorted)
   * so the host can build its Origin facet from live values — the
   * MemoryGraph `onBanksLoaded` pattern.
   */
  onOriginsLoaded?: (origins: string[]) => void;
  /**
   * Fires when the selected-node chip's "View details" is clicked (type or
   * ghost) for the host detail panel. A canvas node click only focus-dims
   * in place and surfaces the chip — Memory/Wiki graph parity.
   */
  onNodeClick?: (node: OntologyGraphNode) => void;
  /**
   * R18 overflow: fires with the count of renderable ghost candidates that
   * did NOT fit under the cap (0 when everything fits) each time server
   * data lands, so the review rail can show "N more in the rail".
   */
  onCandidateOverflow?: (count: number) => void;
  /** Optional live-arrival polling; merges arrivals in place (R17). */
  pollIntervalMs?: number;
  loadingFallback?: React.ReactNode;
  emptyFallback?: React.ReactNode;
  errorFallback?: (message: string, retry: () => void) => React.ReactNode;
}

/** Approved types render in the trusted teal of the trust palette. */
const APPROVED_COLOR = "#14b8a6";
/** Ghost candidates render pending-amber (weak/pending tier). */
const CANDIDATE_COLOR = "#f59e0b";
/** External systems render violet, matching the instance graph's system
 * nodes — the treasure-map "where the data lives" layer. */
const SYSTEM_COLOR = "#a78bfa";
const SYSTEM_NODE_RADIUS = 7;
const CANDIDATE_NODE_RADIUS = 9;
const GHOST_DASH = [3, 2.5];

/** AWSJSON arrives as an object via Yoga but as a JSON string via AppSync
 *  (THINK-188 dual wire shape) — accept both. */
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

function slugList(value: unknown): string[] {
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function candidateValue(candidate: any): Record<string, unknown> {
  return (
    parseAwsJson(candidate.editedValue) ??
    parseAwsJson(candidate.proposedValue) ??
    {}
  );
}

function isRenderableCandidate(candidate: any): boolean {
  const itemType = String(candidate?.itemType ?? "").toLowerCase();
  return itemType === "entity_type" || itemType === "relationship_type";
}

/**
 * Curvature fan for k parallel links sharing an unordered node pair: one
 * link stays straight, two split into +/-0.2, more spread evenly across
 * [-0.3, +0.3]. Values are "absolute side" magnitudes in the pair's
 * canonical orientation (lexicographically smaller endpoint first).
 */
function curvatureSpread(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [0.2, -0.2];
  return Array.from(
    { length: count },
    (_, index) => -0.3 + (0.6 * index) / (count - 1),
  );
}

/**
 * Assign symmetric curvature to every link, grouping by UNORDERED node
 * pair so bidirectional and parallel relationships (approved AND ghost
 * candidates alike) arc apart instead of overlapping on the same chord.
 *
 * Deterministic regardless of input order: links within a pair are sorted
 * by id before values are dealt. The side value is computed in the pair's
 * canonical orientation and sign-flipped for links that run the other way
 * — react-force-graph's control-point offset is perpendicular to the
 * source→target direction, so the flip keeps A→B and B→A on opposite
 * absolute sides consistently.
 *
 * Mutates link objects in place (R17-safe: never replaces them).
 */
export function assignOntologyLinkCurvatures(links: OntologyGraphLink[]): void {
  const byPair = new Map<string, OntologyGraphLink[]>();
  for (const link of links) {
    const sourceId = endpointId(link.source as any);
    const targetId = endpointId(link.target as any);
    const key =
      sourceId < targetId
        ? `${sourceId}\u0000${targetId}`
        : `${targetId}\u0000${sourceId}`;
    const group = byPair.get(key);
    if (group) group.push(link);
    else byPair.set(key, [link]);
  }

  for (const group of byPair.values()) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const sides = curvatureSpread(sorted.length);
    sorted.forEach((link, index) => {
      const sourceId = endpointId(link.source as any);
      const targetId = endpointId(link.target as any);
      const runsCanonical = sourceId <= targetId;
      // `|| 0` normalizes the -0 a sign flip of a straight middle lane
      // would otherwise produce.
      link.curvature = (runsCanonical ? sides[index]! : -sides[index]!) || 0;
    });
  }
}

/** Quadratic bezier coordinate at t (control-point form). */
function quadAt(a: number, c: number, b: number, t: number): number {
  const omt = 1 - t;
  return omt * omt * a + 2 * omt * t * c + t * t * b;
}

/** Blossom of the quadratic — control coordinate of the [u,v] sub-curve. */
function quadBlossom(
  a: number,
  c: number,
  b: number,
  u: number,
  v: number,
): number {
  return (1 - u) * (1 - v) * a + (u + v - 2 * u * v) * c + u * v * b;
}

/**
 * Midpoint (t = 0.5) of a link's quadratic bezier under react-force-graph's
 * curvature model: control point perpendicular to the segment midpoint at
 * curvature * length. This is where the inline label sits — ON the arc,
 * offset from the chord midpoint along the curve normal by curvature/2 of
 * the segment length. Curvature 0 degenerates to the chord midpoint.
 */
export function ontologyLinkLabelMidpoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  curvature: number,
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cpx = (start.x + end.x) / 2 + dy * curvature;
  const cpy = (start.y + end.y) / 2 - dx * curvature;
  return {
    x: quadAt(start.x, cpx, end.x, 0.5),
    y: quadAt(start.y, cpy, end.y, 0.5),
  };
}

/**
 * Project the ontologySchemaGraph payload into force-graph nodes/links.
 * Ghost candidates beyond `cap` are dropped here (R18) and reported via
 * `overflow`. A relationship candidate becomes ghost edges when every
 * needed endpoint type exists on the canvas (approved or ghost entity
 * candidate added earlier in server order); otherwise it falls back to a
 * ghost node so it stays visible and reviewable.
 */
export function buildOntologyGraphData(
  graph: any,
  cap: number = ONTOLOGY_GHOST_CANDIDATE_CAP,
): OntologyGraphData & { overflow: number } {
  const nodes: OntologyGraphNode[] = [];
  const nodeIdBySlug = new Map<string, string>();

  for (const type of graph?.types ?? []) {
    if (!type?.slug) continue;
    const node: OntologyGraphNode = {
      id: `type:${type.slug}`,
      kind: "type",
      slug: type.slug,
      label: type.name ?? type.slug,
      instanceCount: type.instanceCount ?? 0,
      evidenceCount: 0,
      lifecycleStatus: type.lifecycleStatus ?? null,
      itemId: null,
      changeSetId: null,
      itemType: null,
      origin: null,
    };
    nodes.push(node);
    nodeIdBySlug.set(type.slug, node.id);
  }

  const links: OntologyGraphLink[] = [];
  for (const relationship of graph?.relationships ?? []) {
    if (!relationship?.slug) continue;
    for (const sourceSlug of relationship.sourceTypeSlugs ?? []) {
      for (const targetSlug of relationship.targetTypeSlugs ?? []) {
        const sourceId = nodeIdBySlug.get(sourceSlug);
        const targetId = nodeIdBySlug.get(targetSlug);
        if (!sourceId || !targetId) continue;
        links.push({
          id: `rel:${relationship.slug}:${sourceSlug}->${targetSlug}`,
          kind: "relationship",
          source: sourceId,
          target: targetId,
          label: relationship.name ?? relationship.slug,
          slug: relationship.slug,
          itemId: null,
          changeSetId: null,
          evidenceCount: 0,
          curvature: 0,
        });
      }
    }
  }

  // Treasure-map layer: external systems + their identity/data links.
  for (const systemSlug of graph?.systems ?? []) {
    if (typeof systemSlug !== "string" || !systemSlug) continue;
    const node: OntologyGraphNode = {
      id: `system:${systemSlug}`,
      kind: "system",
      slug: systemSlug,
      label: systemSlug,
      instanceCount: 0,
      evidenceCount: 0,
      lifecycleStatus: null,
      itemId: null,
      changeSetId: null,
      itemType: null,
      origin: null,
    };
    nodes.push(node);
  }
  for (const link of graph?.systemLinks ?? []) {
    if (!link?.systemSlug || !link?.entityTypeSlug) continue;
    const typeId = nodeIdBySlug.get(link.entityTypeSlug);
    if (!typeId) continue;
    const label =
      link.identity && link.data
        ? "identity + data"
        : link.data
          ? "data"
          : "identity";
    links.push({
      id: `system:${link.systemSlug}->${link.entityTypeSlug}`,
      kind: "system",
      source: `system:${link.systemSlug}`,
      target: typeId,
      label,
      slug: link.systemSlug,
      itemId: null,
      changeSetId: null,
      evidenceCount: 0,
      curvature: 0,
    });
  }

  const renderable = (graph?.candidates ?? []).filter(isRenderableCandidate);
  const overflow = Math.max(0, renderable.length - cap);

  for (const candidate of renderable.slice(0, cap)) {
    const value = candidateValue(candidate);
    const isRelationship =
      String(candidate.itemType).toLowerCase() === "relationship_type";
    const label =
      (typeof value.name === "string" && value.name) ||
      candidate.slug ||
      "Proposed type";

    if (isRelationship) {
      const sources = slugList(value.sourceTypeSlugs ?? value.sourceTypeSlug);
      const targets = slugList(value.targetTypeSlugs ?? value.targetTypeSlug);
      const pairs: Array<[string, string, string, string]> = [];
      let placeable = sources.length > 0 && targets.length > 0;
      for (const sourceSlug of sources) {
        for (const targetSlug of targets) {
          const sourceId = nodeIdBySlug.get(sourceSlug);
          const targetId = nodeIdBySlug.get(targetSlug);
          if (!sourceId || !targetId) {
            placeable = false;
            continue;
          }
          pairs.push([sourceSlug, targetSlug, sourceId, targetId]);
        }
      }
      if (placeable && pairs.length > 0) {
        for (const [sourceSlug, targetSlug, sourceId, targetId] of pairs) {
          links.push({
            id: `candidate:${candidate.itemId}:${sourceSlug}->${targetSlug}`,
            kind: "candidate",
            source: sourceId,
            target: targetId,
            label,
            slug: candidate.slug ?? null,
            itemId: candidate.itemId,
            changeSetId: candidate.changeSetId,
            evidenceCount: candidate.evidenceCount ?? 0,
            curvature: 0,
          });
        }
        continue;
      }
    }

    const node: OntologyGraphNode = {
      id: `candidate:${candidate.itemId}`,
      kind: "candidate",
      slug: candidate.slug ?? null,
      label,
      instanceCount: 0,
      evidenceCount: candidate.evidenceCount ?? 0,
      lifecycleStatus: null,
      itemId: candidate.itemId,
      changeSetId: candidate.changeSetId,
      itemType: candidate.itemType ?? null,
      origin: candidate.origin ?? null,
    };
    nodes.push(node);
    // Later relationship candidates may attach to this proposed type.
    if (node.slug && !nodeIdBySlug.has(node.slug)) {
      nodeIdBySlug.set(node.slug, node.id);
    }
  }

  assignOntologyLinkCurvatures(links);

  return { nodes, links, overflow };
}

/**
 * R17 live-arrival merge: reconcile `target` (the live, sim-hydrated
 * graphData arrays) against a fresh server payload by MUTATING the arrays
 * in place. Surviving node/link objects keep their identity (and therefore
 * their simulation positions/velocities/pins); new objects are appended;
 * vanished ones are removed. The container and array identities never
 * change, so nothing downstream sees a data swap. Returns the R18 ghost
 * overflow count.
 */
export function mergeOntologyGraphData(
  target: OntologyGraphData,
  graph: any,
  cap: number = ONTOLOGY_GHOST_CANDIDATE_CAP,
): number {
  const next = buildOntologyGraphData(graph, cap);

  const nodeById = new Map(target.nodes.map((node) => [node.id, node]));
  const mergedNodes = next.nodes.map((node) => {
    const existing = nodeById.get(node.id);
    if (!existing) return node;
    existing.label = node.label;
    existing.instanceCount = node.instanceCount;
    existing.evidenceCount = node.evidenceCount;
    existing.lifecycleStatus = node.lifecycleStatus;
    existing.itemType = node.itemType;
    existing.changeSetId = node.changeSetId;
    existing.origin = node.origin;
    existing.slug = node.slug;
    return existing;
  });
  target.nodes.splice(0, target.nodes.length, ...mergedNodes);

  const linkById = new Map(target.links.map((link) => [link.id, link]));
  const mergedLinks = next.links.map((link) => {
    const existing = linkById.get(link.id);
    if (!existing) return link;
    // Keep the (possibly sim-hydrated) source/target objects untouched.
    existing.label = link.label;
    existing.evidenceCount = link.evidenceCount;
    // Curvature was recomputed over the FULL fresh link set (arrivals may
    // create or dissolve parallel pairs) — copy the value onto the
    // surviving object rather than swapping it (R17).
    existing.curvature = link.curvature;
    return existing;
  });
  target.links.splice(0, target.links.length, ...mergedLinks);

  return next.overflow;
}

export function matchesOntologySearch(
  node: OntologyGraphNode,
  searchQuery: string,
): boolean {
  const query = normalizeGraphSearch(searchQuery);
  const haystack = normalizeGraphSearch(
    [node.label, node.slug, node.kind, node.origin].filter(Boolean).join(" "),
  );
  return haystack.includes(query);
}

export const OntologyGraph = forwardRef<
  OntologyGraphHandle,
  OntologyGraphProps
>(function OntologyGraph(
  {
    tenantId,
    searchQuery,
    statusFilter,
    originFilter,
    evidenceFilter,
    activityFilter,
    onNodeClick,
    onCandidateOverflow,
    onOriginsLoaded,
    pollIntervalMs,
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
    query: OntologyGraphQuery,
    variables: { tenantId },
    pause: !tenantId,
  });

  const refetch = useCallback(
    () => reexecute({ requestPolicy: "network-only" }),
    [reexecute],
  );

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    if (!pollIntervalMs) return;
    const id = setInterval(refetch, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, refetch]);

  // R17: the graphData container is created once and only ever mutated in
  // place — its identity (and its arrays') never changes for the life of
  // the component, so the force engine never sees a data swap.
  const graphDataRef = useRef<OntologyGraphData>({ nodes: [], links: [] });
  const overflowRef = useRef(0);
  const lastGraphKeyRef = useRef<string | null>(null);

  // Merge during render (idempotent — keyed on payload content) so the
  // same render that receives data already paints it.
  const payload = result.data?.ontologySchemaGraph ?? null;
  const graphKey = payload === null ? null : JSON.stringify(payload);
  if (graphKey !== null && graphKey !== lastGraphKeyRef.current) {
    lastGraphKeyRef.current = graphKey;
    overflowRef.current = mergeOntologyGraphData(graphDataRef.current, payload);
  }
  const graphData = graphDataRef.current;

  // The react wrapper shallow-compares the graphData prop, so the stable
  // container identity above would never reach the engine on refetch (the
  // imperative ref exposes no graphData setter to poke). Hand the engine a
  // FRESH shallow container per data merge instead: the wrapper re-ingests,
  // while the node/link OBJECTS (and the live arrays above) keep their
  // identity, so surviving nodes carry their positions/velocities and
  // re-ingestion relaxes gently rather than restarting the layout (R17).
  // Without this, live arrivals never reached the simulation — new ghost
  // candidates had no coordinates, so they neither rendered nor hit-tested.
  const engineData = useMemo(
    () => ({
      nodes: graphDataRef.current.nodes,
      links: graphDataRef.current.links,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphKey],
  );

  // R18 overflow surfaced to the review rail at data cadence.
  useEffect(() => {
    if (graphKey === null) return;
    onCandidateOverflow?.(overflowRef.current);
  }, [graphKey, onCandidateOverflow]);

  // Distinct candidate origins surfaced to the host's Origin facet at data
  // cadence (MemoryGraph onBanksLoaded pattern) — only re-emitted when the
  // origin set actually changes.
  const prevOriginsRef = useRef<string | null>(null);
  useEffect(() => {
    if (graphKey === null || !onOriginsLoaded) return;
    const origins = Array.from(
      new Set(
        graphDataRef.current.nodes
          .map((node) => node.origin)
          .filter((origin): origin is string => !!origin),
      ),
    ).sort();
    const key = origins.join(",");
    if (key !== prevOriginsRef.current) {
      prevOriginsRef.current = key;
      onOriginsLoaded(origins);
    }
  }, [graphKey, onOriginsLoaded]);

  // Disc sizes normalize to this graph's instance-count distribution.
  const maxInstanceCount = useMemo(
    () => Math.max(1, ...graphData.nodes.map((node) => node.instanceCount)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphKey],
  );
  const maxInstanceCountRef = useRef(maxInstanceCount);
  maxInstanceCountRef.current = maxInstanceCount;

  const nodeRadius = useCallback((node: any) => {
    if (node.kind === "candidate") return CANDIDATE_NODE_RADIUS;
    if (node.kind === "system") return SYSTEM_NODE_RADIUS;
    return degreeRadius(
      (node.instanceCount ?? 0) + 1,
      maxInstanceCountRef.current + 1,
    );
  }, []);

  // --- Dim-in-place classification (R3): search + focus mutate painter
  // alpha through refs; graphData is never rebuilt for either.
  const hasFacetFilter = Boolean(
    (statusFilter && statusFilter.length > 0) ||
    (originFilter && originFilter.length > 0) ||
    (evidenceFilter && evidenceFilter.length > 0) ||
    (activityFilter && activityFilter.length > 0),
  );
  const matchedIds = useMemo(() => {
    if (!searchQuery && !hasFacetFilter) return null; // null = all match
    let filtered = graphData.nodes.filter((node) =>
      ontologyNodeMatchesFilters(node, {
        statusFilter,
        originFilter,
        evidenceFilter,
        activityFilter,
      }),
    );
    if (searchQuery) {
      filtered = filtered.filter((node) =>
        matchesOntologySearch(node, searchQuery),
      );
    }
    return new Set(filtered.map((node) => node.id));
    // graphKey stands in for graphData content (identity is stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchQuery,
    hasFacetFilter,
    statusFilter,
    originFilter,
    evidenceFilter,
    activityFilter,
    graphKey,
  ]);

  const [focus, setFocus] = useState<GraphFocusState | null>(null);
  const focusRef = useRef<GraphFocusState | null>(null);
  focusRef.current = focus;

  // The focused node renders as an overlay chip instead of immediately
  // opening the host detail sheet — clicking a node should not shift the
  // layout mid-exploration (Memory/Wiki graph parity). Clicking the chip's
  // "View details" opens the sheet via `onNodeClick`.
  const [selectedNode, setSelectedNode] = useState<OntologyGraphNode | null>(
    null,
  );

  const searchClassification = useMemo<GraphClassification | null>(
    () => (matchedIds ? { matchedIds, neighborIds: new Set() } : null),
    [matchedIds],
  );
  const classification = useMemo<GraphClassification | null>(
    () => composeGraphClassification(searchClassification, focus),
    [searchClassification, focus],
  );
  const classificationRef = useRef<GraphClassification | null>(null);
  classificationRef.current = classification;
  const matchedIdsRef = useRef<Set<string> | null>(null);
  matchedIdsRef.current = matchedIds;

  const exitFocus = useCallback(() => {
    setFocus(null);
    setSelectedNode(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (focusRef.current) exitFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitFocus]);

  // Label gating: `auto` follows the shared zoom gate; `on`/`off`
  // override absolutely — same discipline as the sibling components.
  const [labelMode, setLabelMode] = useState<LabelMode>("auto");
  const labelModeRef = useRef<LabelMode>("auto");
  labelModeRef.current = labelMode;
  const zoomKRef = useRef(1);
  const graphDataLiveRef = useRef(graphData);
  graphDataLiveRef.current = graphData;

  const nodeLabelVisible = useCallback((nodeId: string) => {
    const mode = labelModeRef.current;
    if (mode === "on") return true;
    if (mode === "off") return false;
    const gate = labelsVisibleAtScale(
      zoomKRef.current,
      graphDataLiveRef.current.nodes.length,
    );
    const focusState = focusRef.current;
    if (focusState) return gate && focusState.litIds.has(nodeId);
    return gate;
  }, []);

  const linkLabelVisible = useCallback((link: any) => {
    if (labelModeRef.current === "off") return false;
    if (labelModeRef.current === "on") return true;
    const gate = labelsVisibleAtScale(
      zoomKRef.current,
      graphDataLiveRef.current.nodes.length,
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

  const isLinkBright = useCallback((link: any) => {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const focusLit = focusRef.current?.litIds;
    if (focusLit) return focusLit.has(sourceId) && focusLit.has(targetId);
    const matched = matchedIdsRef.current;
    if (!matched) return true;
    return matched.has(sourceId) || matched.has(targetId);
  }, []);

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

  // Canvas painter: approved types are solid teal discs; candidates are
  // dashed-ring ghosts (faint fill, full-alpha dashed rim) with an
  // amber evidence-count badge (R2).
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D) => {
      const state = classifyNode(node.id, classificationRef.current);
      const alpha = state === "matched" ? 1 : 0.15;
      const ghost = node.kind === "candidate";
      const color =
        node.kind === "system"
          ? SYSTEM_COLOR
          : ghost
            ? CANDIDATE_COLOR
            : APPROVED_COLOR;
      const r = nodeRadius(node);

      ctx.globalAlpha = ghost ? alpha * 0.25 : alpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.globalAlpha = alpha;
      if (ghost) {
        ctx.setLineDash?.(GHOST_DASH);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.setLineDash?.([]);
      } else {
        ctx.lineWidth = Math.max(0.75, r * 0.05);
        ctx.strokeStyle = darkenColor(color);
        ctx.stroke();
      }

      if (nodeLabelVisible(node.id)) {
        const rawLabel = node.label ?? "";
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
        ctx.fillStyle = ghost ? color : "#ffffff";
        const lineHeight = fontSize * 1.15;
        const y0 = node.y - ((lines.length - 1) / 2) * lineHeight;
        lines.forEach((line, index) => {
          ctx.fillText(line, node.x, y0 + index * lineHeight);
        });
      }

      // Evidence badge rides the ghost's shoulder so reviewers can rank
      // candidates by support without opening the panel.
      if (ghost && node.evidenceCount > 0) {
        const badgeR = Math.max(3.5, r * 0.42);
        const bx = node.x + r * 0.85;
        const by = node.y - r * 0.85;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, 2 * Math.PI);
        ctx.fillStyle = CANDIDATE_COLOR;
        ctx.fill();
        const badgeFont = badgeR * 1.1;
        ctx.font = `700 ${badgeFont}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(node.evidenceCount), bx, by);
      }
      ctx.globalAlpha = 1;
    },
    [nodeLabelVisible, nodeRadius],
  );

  // Link painter: approved relationships draw solid with an inline label
  // (neo4j style); candidate relationships draw the same geometry dashed
  // in pending-amber (R2). Every link renders as the quadratic bezier of
  // its assigned `curvature` (react-force-graph's control-point model, so
  // native link machinery agrees with our geometry) — curvature 0
  // degenerates exactly to the straight chord, and parallel/bidirectional
  // links arc apart so labels and arrowheads never collide.
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source;
      const end = link.target;
      if (typeof start !== "object" || typeof end !== "object") return;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (!dist) return;
      const sourceTrim = nodeRadius(start) + 1.5;
      const targetTrim = nodeRadius(end) + 1.5;
      if (dist <= sourceTrim + targetTrim) return;
      const lineLen = dist - sourceTrim - targetTrim;

      // Quadratic control point (force-graph model): perpendicular to the
      // segment midpoint at curvature * length.
      const curvature = link.curvature ?? 0;
      const cpx = (start.x + end.x) / 2 + dy * curvature;
      const cpy = (start.y + end.y) / 2 - dx * curvature;
      // Trim endpoints out of the node discs in bezier parameter space
      // (chord-length approximation — exact for straight links).
      const t0 = sourceTrim / dist;
      const t1 = 1 - targetTrim / dist;

      const strokeSegment = (u: number, v: number) => {
        if (v <= u) return;
        ctx.beginPath();
        ctx.moveTo(
          quadAt(start.x, cpx, end.x, u),
          quadAt(start.y, cpy, end.y, u),
        );
        ctx.quadraticCurveTo(
          quadBlossom(start.x, cpx, end.x, u, v),
          quadBlossom(start.y, cpy, end.y, u, v),
          quadAt(start.x, cpx, end.x, v),
          quadAt(start.y, cpy, end.y, v),
        );
        ctx.stroke();
      };

      const ghost = link.kind === "candidate";
      const filtering = !!matchedIdsRef.current;
      const baseColor =
        link.kind === "system"
          ? SYSTEM_COLOR
          : ghost
            ? CANDIDATE_COLOR
            : APPROVED_COLOR;
      const color = isLinkBright(link)
        ? `${baseColor}${filtering ? "55" : "cc"}`
        : `rgba(148,163,184,${filtering ? "0.05" : "0.15"})`;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1 / globalScale;
      if (ghost) ctx.setLineDash?.(GHOST_DASH.map((d) => d / globalScale));

      let labeled = false;
      if (linkLabelVisible(link)) {
        const label = link.label || "related to";
        const fontSize = 10 / globalScale;
        ctx.font = `${fontSize}px sans-serif`;
        const textWidth =
          ctx.measureText?.(label)?.width ?? label.length * fontSize * 0.6;
        const gap = textWidth + 10 / globalScale;
        if (lineLen > gap + 14 / globalScale) {
          // Break the stroke around t=0.5 and sit the label ON the arc:
          // the bezier midpoint is the chord midpoint pushed along the
          // curve normal by curvature/2 of the segment length.
          const halfT = gap / 2 / dist;
          strokeSegment(t0, 0.5 - halfT);
          strokeSegment(0.5 + halfT, t1);
          const mid = ontologyLinkLabelMidpoint(start, end, curvature);
          // Tangent at t=0.5 of a quadratic is parallel to the chord.
          let angle = Math.atan2(dy, dx);
          if (angle > Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate(mid.x, mid.y);
          ctx.rotate(angle);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.setLineDash?.([]);
          ctx.fillText(label, 0, 0);
          ctx.restore();
          if (ghost) ctx.setLineDash?.(GHOST_DASH.map((d) => d / globalScale));
          labeled = true;
        }
      }
      if (!labeled) {
        strokeSegment(t0, t1);
      }

      // Arrowhead rides the curve tangent at the target-disc rim, so
      // arrows on parallel links land at distinct points/angles.
      ctx.setLineDash?.([]);
      const tipX = quadAt(start.x, cpx, end.x, t1);
      const tipY = quadAt(start.y, cpy, end.y, t1);
      // B'(t1) = 2(1-t1)(cp - start) + 2*t1*(end - cp)
      const tanXRaw = 2 * (1 - t1) * (cpx - start.x) + 2 * t1 * (end.x - cpx);
      const tanYRaw = 2 * (1 - t1) * (cpy - start.y) + 2 * t1 * (end.y - cpy);
      const tanLen = Math.hypot(tanXRaw, tanYRaw) || 1;
      const ux = tanXRaw / tanLen;
      const uy = tanYRaw / tanLen;
      const ah = 4;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(
        tipX - ux * ah - uy * (ah * 0.5),
        tipY - uy * ah + ux * (ah * 0.5),
      );
      ctx.lineTo(
        tipX - ux * ah + uy * (ah * 0.5),
        tipY - uy * ah - ux * (ah * 0.5),
      );
      ctx.closePath();
      ctx.fill();
    },
    [linkLabelVisible, isLinkBright, nodeRadius],
  );

  // Force registration happens at mount cadence only — schema graphs are
  // small (tens of nodes) and re-registration on data merges would fight
  // the R17 no-restart invariant.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-140).distanceMax(260);
    fg.d3Force("link")?.distance(90);
    fg.d3Force(
      "collide",
      d3
        .forceCollide()
        .radius((node: any) => nodeRadius(node) + 14)
        .strength(0.9),
    );
    // `dims` re-runs this once the engine actually mounts.
  }, [dims, nodeRadius]);

  const { tooltip } = useGraphPointer({
    containerEl,
    fgRef,
    graphDataRef: graphDataLiveRef,
    nodeRadius,
    tooltipText: (node: any) =>
      node.kind === "candidate"
        ? `${node.label} - proposed - ${node.evidenceCount} evidence item${
            node.evidenceCount === 1 ? "" : "s"
          }`
        : `${node.label} - ${node.instanceCount} instance${
            node.instanceCount === 1 ? "" : "s"
          }`,
    onNodeClick: (node: any) => {
      const expansion = expandNeighborhood(
        [node.id],
        graphDataLiveRef.current.links,
        DEFAULT_FOCUS_DEGREE,
        DEFAULT_FOCUS_CAP,
      );
      setFocus({
        focusedId: node.id,
        litIds: expansion.ids,
        degreeUsed: expansion.degreeUsed,
        truncated: expansion.truncated,
      });
      // Focus dims in place and surfaces the chip; the detail sheet only
      // opens from the chip's "View details" (sibling-graph UX).
      setSelectedNode(node as OntologyGraphNode);
    },
    onBackgroundClick: () => {
      if (focusRef.current) exitFocus();
    },
  });

  // One-shot framing after the first settle; zoom/pan belongs to the
  // user afterwards (R3/R17 — later data merges never re-frame).
  const zoomInitRef = useRef(false);
  const [framed, setFramed] = useState(false);

  if (result.fetching && !result.data) {
    return (
      loadingFallback ?? (
        <div
          data-testid="ontology-graph-loading"
          className="flex h-full min-h-48 items-center justify-center py-16"
        >
          <div className="flex items-center gap-3 animate-pulse">
            <span className="inline-block h-4 w-4 rounded-full bg-muted" />
            <span className="inline-block h-3 w-40 rounded bg-muted" />
            <span className="sr-only">Loading ontology map...</span>
          </div>
        </div>
      )
    );
  }

  if (result.error && graphData.nodes.length === 0) {
    return (
      errorFallback?.(result.error.message, refetch) ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">Ontology map could not load.</p>
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

  if (graphData.nodes.length === 0) {
    return (
      emptyFallback ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No ontology types yet. Approve a change set or install a starter
            pack to seed the map.
          </p>
        </div>
      )
    );
  }

  const candidateCount = graphData.nodes.filter(
    (node) => node.kind === "candidate",
  ).length;
  const candidateEdgeCount = graphData.links.filter(
    (link) => link.kind === "candidate",
  ).length;

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
        graphData={engineData}
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={nodeCanvasObject}
        // Continuous repaint so ref-driven focus/filter/zoom changes show
        // without rebuilding graphData.
        autoPauseRedraw={false}
        enablePointerInteraction={false}
        linkLabel={(link: any) => link.label || "related to"}
        linkCurvature={(link: any) => link.curvature ?? 0}
        linkCanvasObjectMode={() => "replace" as const}
        linkCanvasObject={linkCanvasObject}
        // The schema map is small — let it settle LIVE with natural d3
        // decay instead of pre-warming off-screen: the frozen "muted"
        // look came from warmup + heavy damping (Eric, 2026-07-22).
        cooldownTicks={300}
        d3AlphaDecay={0.0228}
        d3VelocityDecay={0.4}
        warmupTicks={0}
        onZoom={({ k }: { k: number }) => {
          zoomKRef.current = k;
        }}
        onEngineStop={() => {
          if (zoomInitRef.current) return;
          zoomInitRef.current = true;
          fgRef.current?.zoomToFit?.(0, 40);
          const k = fgRef.current?.zoom?.();
          if (typeof k === "number" && k < 0.55) {
            fgRef.current?.zoom?.(0.55, 0);
          }
          setFramed(true);
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-20">
        {focus && selectedNode && (
          <div className="pointer-events-auto absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
            <button
              type="button"
              aria-label={`Open details for ${selectedNode.label}`}
              className="flex items-center gap-2 text-xs bg-background/90 border border-border rounded-full px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => onNodeClick?.(selectedNode)}
            >
              <span className="font-medium">{selectedNode.label}</span>
              <span className="text-muted-foreground">View details</span>
            </button>
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
      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[11px] text-muted-foreground bg-background/80 rounded px-3 py-1.5 flex-wrap">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: APPROVED_COLOR }}
          />
          Approved ({graphData.nodes.length - candidateCount})
        </span>
        {candidateCount + candidateEdgeCount > 0 && (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-dashed"
              style={{ borderColor: CANDIDATE_COLOR }}
            />
            Proposed ({candidateCount + candidateEdgeCount})
          </span>
        )}
      </div>
    </div>
  );
});
