import Graph from "graphology";
import louvain from "graphology-communities-louvain";

export type GraphEndpoint = string | { id: string };

export type GraphLinkLike = {
  source: GraphEndpoint;
  target: GraphEndpoint;
};

export type NodeVisualState = "matched" | "neighbor" | "other";

export type GraphClassification = {
  matchedIds: Set<string>;
  neighborIds: Set<string>;
};

export function endpointId(endpoint: GraphEndpoint): string {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

export function normalizeGraphSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyNode(
  id: string,
  classification: GraphClassification | null,
): NodeVisualState {
  if (!classification) return "matched";
  if (classification.matchedIds.has(id)) return "matched";
  if (classification.neighborIds.has(id)) return "neighbor";
  return "other";
}

export function deriveGraphClassification<TLink extends GraphLinkLike>(
  matchedIds: Set<string> | null,
  links: readonly TLink[],
): GraphClassification | null {
  if (!matchedIds) return null;

  const neighborIds = new Set<string>();
  for (const link of links) {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const sourceMatched = matchedIds.has(sourceId);
    const targetMatched = matchedIds.has(targetId);
    if (sourceMatched && !targetMatched) neighborIds.add(targetId);
    else if (targetMatched && !sourceMatched) neighborIds.add(sourceId);
  }

  return { matchedIds, neighborIds };
}

/** Neighborhood depth lit by Graph Focus Mode. */
export const DEFAULT_FOCUS_DEGREE = 2;
/** Above this lit-set size, focus silently degrades to 1 degree (R5). */
export const DEFAULT_FOCUS_CAP = 150;

/** Focus state produced by clicking a node (Graph Focus Mode). The lit set
 *  always contains the focused node itself. */
export type GraphFocusState = {
  focusedId: string;
  litIds: Set<string>;
  degreeUsed: number;
  truncated: boolean;
};

/**
 * Compose search and focus classification: focus wins while active (lit set
 * renders as "matched", everything else as "other"), the search
 * classification is untouched underneath and returned again once focus
 * clears. Neighbor rings are a search-only affordance — focus mode lights
 * the whole neighborhood at full opacity instead.
 */
export function composeGraphClassification(
  search: GraphClassification | null,
  focus: GraphFocusState | null,
): GraphClassification | null {
  if (focus) {
    return { matchedIds: focus.litIds, neighborIds: new Set() };
  }
  return search;
}

/** Deterministic RNG (mulberry32) so louvain partitions are stable across
 *  reloads of the same graph. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type CommunityDetectionOptions = {
  /** Louvain resolution — higher yields more, smaller communities. */
  resolution?: number;
  seed?: number;
};

/**
 * Assign every node to a community based on edge structure (Louvain).
 * Deterministic for a given (graph, seed). Isolated nodes and edgeless
 * graphs each get singleton communities rather than throwing — louvain
 * rejects graphs without edges. Parallel edges collapse via mergeEdge.
 */
export function detectCommunities<TLink extends GraphLinkLike>(
  nodes: readonly { id: string }[],
  links: readonly TLink[],
  { resolution = 1, seed = 1 }: CommunityDetectionOptions = {},
): Map<string, number> {
  const result = new Map<string, number>();
  if (nodes.length === 0) return result;

  const graph = new Graph({ type: "undirected", multi: false });
  for (const node of nodes) graph.mergeNode(node.id);
  for (const link of links) {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) continue;
    if (sourceId === targetId) continue; // louvain rejects self-loops
    graph.mergeEdge(sourceId, targetId);
  }

  if (graph.size === 0) {
    nodes.forEach((node, i) => result.set(node.id, i));
    return result;
  }

  const communities = louvain(graph, {
    resolution,
    rng: seededRng(seed),
    getEdgeWeight: null,
  });
  // Louvain community ids are arbitrary; renumber densely in first-seen
  // node order so ids are stable for anchor placement.
  const renumber = new Map<number | string, number>();
  for (const node of nodes) {
    const raw = communities[node.id];
    const key = raw ?? `__isolated:${node.id}`;
    if (!renumber.has(key)) renumber.set(key, renumber.size);
    result.set(node.id, renumber.get(key)!);
  }
  return result;
}

export type CommunityAnchor = { x: number; y: number };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Place one anchor per community on a golden-angle spiral, packed so the
 * spiral's cumulative area tracks the summed cluster areas. Cluster radius
 * scales with sqrt(member count) so big communities claim more room, and
 * `gap` opens consistent breathing space between clusters. Largest
 * community sits at the origin, keeping the layout centered without a
 * d3 center force.
 */
export function computeCommunityAnchors(
  communityByNode: ReadonlyMap<string, number>,
  { spacing = 26, gap = 1.35 }: { spacing?: number; gap?: number } = {},
): Map<number, CommunityAnchor> {
  const counts = new Map<number, number>();
  for (const communityId of communityByNode.values()) {
    counts.set(communityId, (counts.get(communityId) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  );

  const anchors = new Map<number, CommunityAnchor>();
  let placedArea = 0;
  ordered.forEach(([communityId, count], index) => {
    const radius = spacing * Math.sqrt(count);
    if (index === 0) {
      anchors.set(communityId, { x: 0, y: 0 });
    } else {
      const dist = (Math.sqrt(placedArea / Math.PI) + radius) * gap;
      const angle = index * GOLDEN_ANGLE;
      anchors.set(communityId, {
        x: dist * Math.cos(angle),
        y: dist * Math.sin(angle),
      });
    }
    placedArea += Math.PI * radius * radius;
  });
  return anchors;
}

export type CommunityLayout = {
  communityByNode: Map<string, number>;
  anchors: Map<number, CommunityAnchor>;
};

/** One-call community layout: louvain assignment + spiral anchors. Runs at
 *  graphData-identity cadence only — never on filter/focus changes. */
export function computeCommunityLayout<TLink extends GraphLinkLike>(
  nodes: readonly { id: string }[],
  links: readonly TLink[],
  options: CommunityDetectionOptions & {
    spacing?: number;
    gap?: number;
  } = {},
): CommunityLayout {
  const communityByNode = detectCommunities(nodes, links, options);
  const anchors = computeCommunityAnchors(communityByNode, options);
  return { communityByNode, anchors };
}

export type NeighborhoodExpansion = {
  ids: Set<string>;
  degreeUsed: number;
  truncated: boolean;
};

/**
 * BFS expansion of seed ids out to `degree` hops. If the expanded set
 * exceeds `cap`, degrade one degree at a time (2° → 1°) and report
 * `truncated: true`; degree 1 is always accepted regardless of size so a
 * hub node still lights its direct neighbors.
 */
export function expandNeighborhood(
  seedIds: Iterable<string>,
  links: readonly GraphLinkLike[],
  degree: number,
  cap: number,
): NeighborhoodExpansion {
  const seeds = new Set(seedIds);
  if (seeds.size === 0) {
    return { ids: new Set(), degreeUsed: degree, truncated: false };
  }

  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    if (sourceId === targetId) continue;
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
    if (!adjacency.has(targetId)) adjacency.set(targetId, []);
    adjacency.get(sourceId)!.push(targetId);
    adjacency.get(targetId)!.push(sourceId);
  }

  // Levels: levels[0] = seeds, levels[k] = nodes first reached at hop k.
  const visited = new Set(seeds);
  const cumulative: Set<string>[] = [new Set(seeds)];
  let frontier = [...seeds];
  for (let hop = 1; hop <= degree; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    cumulative.push(new Set(visited));
    frontier = next;
  }

  for (let d = degree; d >= 1; d -= 1) {
    const ids = cumulative[Math.min(d, cumulative.length - 1)]!;
    if (ids.size <= cap || d === 1) {
      return { ids: new Set(ids), degreeUsed: d, truncated: d < degree };
    }
  }
  return { ids: new Set(seeds), degreeUsed: degree, truncated: false };
}

const CARRIED_POSITION_KEYS = [
  "x",
  "y",
  "z",
  "vx",
  "vy",
  "vz",
  "fx",
  "fy",
  "fz",
] as const;

/**
 * Copy simulation positions and user-drag pins (fx/fy) from a previous
 * node array onto freshly built nodes by id, so a refetch doesn't scatter
 * the layout or drop pins. Mutates and returns `next`.
 */
export function carryNodePositions<TNode extends { id: string }>(
  prev: readonly { id: string }[] | null | undefined,
  next: TNode[],
): TNode[] {
  if (!prev || prev.length === 0) return next;
  const prevById = new Map(prev.map((node) => [node.id, node as any]));
  for (const node of next as any[]) {
    const previous = prevById.get(node.id);
    if (!previous) continue;
    for (const key of CARRIED_POSITION_KEYS) {
      if (previous[key] !== undefined) node[key] = previous[key];
    }
  }
  return next;
}

export function connectedGraphEdges<
  TNode extends { id: string; label: string; nodeType?: string },
  TLink extends GraphLinkLike & { label?: string | null },
>(
  nodeId: string,
  nodes: readonly TNode[],
  links: readonly TLink[],
  fallbackType = "entity",
): {
  label: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
}[] {
  return links
    .filter((link) => {
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      return sourceId === nodeId || targetId === nodeId;
    })
    .map((link) => {
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      const otherId = sourceId === nodeId ? targetId : sourceId;
      const otherNode = nodes.find((node) => node.id === otherId);
      return {
        label: link.label || "related to",
        targetLabel: otherNode?.label ?? otherId,
        targetType: otherNode?.nodeType ?? fallbackType,
        targetId: otherId,
      };
    });
}
