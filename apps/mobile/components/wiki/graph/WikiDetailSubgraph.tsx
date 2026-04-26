import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  type WikiGraphEdgeFromServer,
  type WikiGraphNodeFromServer,
  type WikiGraphPayload,
  useWikiGraph,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { KnowledgeGraph } from "./KnowledgeGraph";
import {
  NodeDetailModal,
  type NodeDetailModalTarget,
} from "./NodeDetailModal";
import { oneHopNeighborhood } from "./layout/neighborhood";
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiPageType,
  WikiSubgraph,
} from "./types";

interface WikiDetailSubgraphProps {
  tenantId: string;
  userId: string;
  pageId: string;
}

/**
 * Embeds a `KnowledgeGraph` scoped to the 1-hop neighborhood around the
 * given page. Tapping a neighbor opens the same centered preview modal
 * the main graph uses, keeping the interaction consistent.
 */
export function WikiDetailSubgraph({
  tenantId,
  userId,
  pageId,
}: WikiDetailSubgraphProps) {
  const router = useRouter();
  const { graph, error } = useWikiGraph({ tenantId, userId });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const neighborhood = useMemo(
    () => (graph ? oneHopNeighborhood(graph, pageId) : null),
    [graph, pageId],
  );

  const subgraph = useMemo(
    () => (neighborhood ? toInternalSubgraph(neighborhood) : null),
    [neighborhood],
  );

  const selectedTarget: NodeDetailModalTarget | null = useMemo(() => {
    if (!subgraph || !selectedNodeId) return null;
    const node = subgraph.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return null;
    return {
      id: node.id,
      type: node.pageType,
      slug: node.slug,
      title: node.label,
    };
  }, [subgraph, selectedNodeId]);

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      if (!nodeId || !subgraph) return;
      if (nodeId === pageId) return; // tapping the focal is a no-op
      setSelectedNodeId(nodeId);
    },
    [subgraph, pageId],
  );

  const handleOpenFullPage = useCallback(
    (target: NodeDetailModalTarget) => {
      setSelectedNodeId(null);
      const base = `/wiki/${encodeURIComponent(target.type)}/${encodeURIComponent(target.slug)}`;
      router.push(`${base}?userId=${encodeURIComponent(userId)}`);
    },
    [router, userId],
  );

  if (error) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{error.message}</Text>
      </View>
    );
  }
  if (!subgraph) {
    return <View style={styles.fallback} />;
  }
  if (subgraph.nodes.length <= 1) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          No connected pages yet — once compile links this page to another,
          the neighborhood appears here.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <KnowledgeGraph
        subgraph={subgraph}
        selectedNodeId={selectedNodeId ?? pageId}
        onSelectNode={handleSelectNode}
        showRevealLoader={false}
        showLabels
        simConfig={{
          linkDistance: 90,
          chargeStrength: -260,
          collideRadius: 42,
          xyStrength: 0.04,
        }}
      />
      <NodeDetailModal
        tenantId={tenantId}
        userId={userId}
        node={selectedTarget}
        onClose={() => setSelectedNodeId(null)}
        onOpenFullPage={handleOpenFullPage}
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
    depth: 1,
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
  root: { flex: 1 },
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
