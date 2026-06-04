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
