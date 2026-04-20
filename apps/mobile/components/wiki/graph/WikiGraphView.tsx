import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  type WikiGraphEdgeFromServer,
  type WikiGraphNodeFromServer,
  type WikiGraphPayload,
  useWikiGraph,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { NodeDetailSheet } from "./NodeDetailSheet";
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiPageType,
  WikiSubgraph,
} from "./types";

interface WikiGraphViewProps {
  tenantId: string;
  agentId: string;
  /**
   * Optional: route param kept for backwards compat with existing callers,
   * but the default view is "show all pages for this agent" — focal-mode
   * is intentionally not the default after Unit 3 validation showed
   * single-node lonely focals were the common case for real data.
   */
  initialFocalPageId?: string | null;
  /**
   * When non-empty, dims nodes whose label/summary doesn't match (case-
   * insensitive substring) to 15% opacity. Lets the shared "Search wiki…"
   * footer filter the graph in place.
   */
  searchQuery?: string;
}

/**
 * Top-level wiring for the graph viewer. Now defaults to "show every
 * active page in the agent's scope" via `useWikiGraph` (same resolver
 * the admin `/wiki` route uses). The depth-bounded focal+expand model
 * from Unit 3's first iteration is parked for a future follow-up — the
 * default view should match user expectations from the admin surface.
 */
export function WikiGraphView({
  tenantId,
  agentId,
  searchQuery,
}: WikiGraphViewProps) {
  const { graph, loading, error } = useWikiGraph({
    tenantId,
    ownerId: agentId,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const internalSubgraph = useMemo(
    () => (graph ? toInternalSubgraph(graph) : null),
    [graph],
  );

  const selectedNode = useMemo(() => {
    if (!internalSubgraph || !selectedNodeId) return null;
    return internalSubgraph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [internalSubgraph, selectedNodeId]);

  // Search filter: client-side dim of nodes whose label/summary doesn't match.
  const dimmedNodeIds = useMemo(() => {
    const q = (searchQuery ?? "").trim().toLowerCase();
    if (!q || !internalSubgraph) return new Set<string>();
    const dimmed = new Set<string>();
    for (const n of internalSubgraph.nodes) {
      if (!(n.label ?? "").toLowerCase().includes(q)) dimmed.add(n.id);
    }
    return dimmed;
  }, [searchQuery, internalSubgraph]);

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>{error.message}</Text>
        </View>
      ) : !internalSubgraph ? (
        <View style={styles.fallback}>
          {loading ? (
            <ActivityIndicator color={COLORS.dark.mutedForeground} />
          ) : (
            <Text style={styles.fallbackText}>
              No compounded knowledge yet — once the compile pipeline runs for
              this agent, pages and links show up here.
            </Text>
          )}
        </View>
      ) : internalSubgraph.nodes.length === 0 ? (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>
            No pages compiled yet for this agent.
          </Text>
        </View>
      ) : (
        <KnowledgeGraph
          subgraph={internalSubgraph}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          dimmedNodeIds={dimmedNodeIds}
        />
      )}

      <NodeDetailSheet
        tenantId={tenantId}
        ownerId={agentId}
        node={
          selectedNode
            ? {
                id: selectedNode.id,
                type: selectedNode.pageType,
                slug: selectedNode.slug,
                title: selectedNode.label,
                summary: selectedNode.summaryPreview ?? null,
                status: selectedNode.status,
                lastCompiledAt: selectedNode.lastCompiledAt,
                updatedAt: selectedNode.lastCompiledAt,
              }
            : null
        }
        onClose={() => setSelectedNodeId(null)}
        onFocusHere={() => setSelectedNodeId(null)}
      />
    </View>
  );
}

function toInternalSubgraph(payload: WikiGraphPayload): WikiSubgraph {
  const NOW = new Date().toISOString();
  const nodes: WikiGraphNode[] = payload.nodes.map((n) => nodeFromPayload(n, NOW));
  const edges: WikiGraphEdge[] = payload.edges.map((e, idx) =>
    edgeFromPayload(e, idx, NOW),
  );
  return {
    focalPageId: nodes[0]?.id ?? "",
    depth: 0,
    atTime: NOW,
    nodes,
    edges,
    hasMore: {},
  };
}

function nodeFromPayload(p: WikiGraphNodeFromServer, now: string): WikiGraphNode {
  return {
    id: p.id,
    slug: p.slug,
    label: p.label,
    pageType: p.entityType as WikiPageType,
    lastCompiledAt: now,
    status: "ACTIVE",
    primaryAgentIds: [],
  };
}

function edgeFromPayload(
  e: WikiGraphEdgeFromServer,
  idx: number,
  now: string,
): WikiGraphEdge {
  return {
    id: `${e.source}-${e.target}-${idx}`,
    source: e.source,
    target: e.target,
    firstSeenAt: now,
    lastSeenAt: now,
    isCurrent: true,
    weight: e.weight,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark.background },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  fallbackText: {
    color: COLORS.dark.mutedForeground,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
