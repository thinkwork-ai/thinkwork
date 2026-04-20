import type { WikiGraphPayload } from "@thinkwork/react-native-sdk";

/**
 * Filters a full agent graph payload down to a 1-hop neighborhood around
 * `pageId`: the page itself + every node directly connected by an edge +
 * every edge whose endpoints both fall inside that set.
 *
 * Returns an empty payload if `pageId` isn't in `graph.nodes`.
 */
export function oneHopNeighborhood(
  graph: WikiGraphPayload,
  pageId: string,
): WikiGraphPayload {
  if (!graph.nodes.some((n) => n.id === pageId)) {
    return { nodes: [], edges: [] };
  }
  const keep = new Set<string>([pageId]);
  for (const e of graph.edges) {
    if (e.source === pageId) keep.add(e.target);
    if (e.target === pageId) keep.add(e.source);
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter(
    (e) => keep.has(e.source) && keep.has(e.target),
  );
  return { nodes, edges };
}
