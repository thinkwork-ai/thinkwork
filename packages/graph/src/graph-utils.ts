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

/** Narrow FOV flattens perspective distortion into a near-orthographic,
 *  2D-feeling view (the library default is 50°). */
export const FLAT_CAMERA_FOV = 20;

/** Distance multiplier that keeps framing identical after narrowing the
 *  FOV from the library's 50° default. Exported for tests. */
export const CAMERA_DISTANCE_SCALE =
  Math.tan((50 / 2) * (Math.PI / 180)) /
  Math.tan((FLAT_CAMERA_FOV / 2) * (Math.PI / 180));

/** One-shot starting camera distance — scales with node count so large
 *  graphs start framed. Shared by camera init and the label zoom gate.
 *  Includes the flat-FOV compensation. */
export function initialCameraZ(nodeCount: number): number {
  return (
    Math.max(800, Math.min(6000, 100 * Math.sqrt(nodeCount))) *
    CAMERA_DISTANCE_SCALE
  );
}

/** Graphs at or below this node count always show labels — gating adds
 *  nothing when everything fits on screen. */
export const LABEL_GATE_ALWAYS_MAX_NODES = 150;

/**
 * Zoom gate for overview node labels (R8): visible on small graphs, and on
 * large graphs only once the camera is close enough that few nodes remain
 * on screen. Threshold is relative to the initial framing distance.
 */
export function labelsVisibleAtZoom(
  cameraZ: number,
  nodeCount: number,
): boolean {
  if (nodeCount <= LABEL_GATE_ALWAYS_MAX_NODES) return true;
  return (
    cameraZ <=
    Math.max(700 * CAMERA_DISTANCE_SCALE, initialCameraZ(nodeCount) * 0.25)
  );
}

/** Canvas-renderer zoom gate (react-force-graph-2d): `k` is the canvas
 *  zoom scale from onZoom. Below this, node text would render under
 *  ~7px — unreadable — so labels hide on large graphs. */
export const LABEL_GATE_MIN_SCALE = 0.7;

export function labelsVisibleAtScale(k: number, nodeCount: number): boolean {
  if (nodeCount <= LABEL_GATE_ALWAYS_MAX_NODES) return true;
  return k >= LABEL_GATE_MIN_SCALE;
}

/** Distinct hues cycled across detected communities so cluster membership
 *  reads at a glance (the neo4j-browser look). */
export const COMMUNITY_COLORS = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#4ade80", // green
  "#facc15", // yellow
  "#a78bfa", // violet
  "#f87171", // red
  "#38bdf8", // sky
  "#fb923c", // orange
  "#34d399", // emerald
  "#e879f9", // fuchsia
  "#fbbf24", // amber
  "#2dd4bf", // teal
];

export function communityColor(communityId: number | undefined): string {
  if (communityId === undefined) return COMMUNITY_COLORS[0]!;
  return COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length]!;
}

/**
 * Word-wrap a node label to fit inside a disc (neo4j style): up to
 * `maxLines` lines within `maxWidth`, ellipsized when it can't fit.
 * `measure` is the canvas text measurer for the already-set font.
 */
export function wrapLabelLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines = 3,
): string[] {
  const truncate = (value: string): string => {
    if (measure(value) <= maxWidth) return value;
    let out = value;
    while (out.length > 1 && measure(out + "…") > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + "…";
  };

  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let overflow = false;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!current) {
      // Single word wider than the disc.
      lines.push(truncate(word));
    } else {
      lines.push(current);
      i -= 1; // reprocess this word on the next line
    }
    current = "";
    if (lines.length === maxLines) {
      overflow = true;
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  else if (current) overflow = true;

  if (overflow && lines.length > 0) {
    lines[lines.length - 1] = truncate(lines[lines.length - 1] + "…");
  }
  return lines;
}

/** The web app toggles theme by stamping `dark` on the root element
 *  (see apps/web `applets/mount.tsx`) — the canvas painters read it per
 *  frame so graph chrome follows the theme. */
export function isDarkMode(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

/** Legible text color for a label drawn ON a colored disc, independent of
 *  page theme — picked by the disc color's relative luminance. */
export function contrastTextColor(hex: string): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return "#ffffff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1e293b" : "#ffffff";
}

/** Darken a hex color for disc rims (canvas has no material math). */
export function darkenColor(hex: string, factor = 0.55): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

/** Tri-state label visibility control: `auto` follows zoom gating and
 *  focus defaults; `on`/`off` override absolutely (R11). */
export type LabelMode = "auto" | "on" | "off";

/** Neighborhood depth lit by Graph Focus Mode: the clicked node and its
 *  direct connections. */
export const DEFAULT_FOCUS_DEGREE = 1;
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
