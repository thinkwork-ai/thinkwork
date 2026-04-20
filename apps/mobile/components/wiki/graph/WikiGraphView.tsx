import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  type WikiSubgraphLink,
  type WikiSubgraphPage,
  type WikiSubgraphPayload,
  useWikiSubgraph,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import { GraphHeader } from "./GraphHeader";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { NodeDetailSheet } from "./NodeDetailSheet";
import { useFocusMode } from "./hooks/useFocusMode";
import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiPageType,
  WikiSubgraph,
} from "./types";

interface WikiGraphViewProps {
  tenantId: string;
  agentId: string;
  initialFocalPageId?: string | null;
}

/**
 * Top-level wiring for the graph viewer. Owns:
 *   - focal page resolution (route → AsyncStorage → recent Entity)
 *   - subgraph fetch via `useWikiSubgraph`
 *   - selection state + detail-sheet presentation
 *
 * Adapts the SDK's `WikiSubgraphPayload` shape into the internal
 * `WikiSubgraph` shape that `KnowledgeGraph` expects (the internal
 * shape carries Unit 5+ aspirational fields like temporal flags;
 * the SDK shape only ships what the resolver returns today).
 */
export function WikiGraphView({
  tenantId,
  agentId,
  initialFocalPageId,
}: WikiGraphViewProps) {
  const focus = useFocusMode({
    tenantId,
    agentId,
    routeFocalPageId: initialFocalPageId ?? null,
  });

  const { subgraph, loading, error } = useWikiSubgraph({
    tenantId,
    ownerId: agentId,
    focalPageId: focus.focalPageId,
    depth: focus.depth,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const internalSubgraph = useMemo(
    () => (subgraph ? toInternalSubgraph(subgraph) : null),
    [subgraph],
  );

  const focalNode = useMemo(() => {
    if (!subgraph) return null;
    return subgraph.nodes.find((n) => n.id === subgraph.focalPageId) ?? null;
  }, [subgraph]);

  const selectedNode = useMemo(() => {
    if (!subgraph || !selectedNodeId) return null;
    return subgraph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [subgraph, selectedNodeId]);

  const truncated =
    !!subgraph &&
    subgraph.hasMore.some(
      (e) => e.pageId === subgraph.focalPageId && e.hasMore,
    );

  return (
    <View style={styles.root}>
      <GraphHeader
        focalTitle={focalNode?.title ?? null}
        depth={focus.depth}
        onIncreaseDepth={() => focus.setDepth(focus.depth + 1)}
        onDecreaseDepth={() => focus.setDepth(focus.depth - 1)}
        truncated={truncated}
      />

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
      ) : (
        <KnowledgeGraph
          subgraph={internalSubgraph}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      )}

      <NodeDetailSheet
        tenantId={tenantId}
        ownerId={agentId}
        node={selectedNode}
        onClose={() => setSelectedNodeId(null)}
        onFocusHere={(pageId) => {
          focus.setFocus(pageId);
          setSelectedNodeId(null);
        }}
      />
    </View>
  );
}

function toInternalSubgraph(payload: WikiSubgraphPayload): WikiSubgraph {
  const lookup = new Map<string, WikiGraphNode>();
  const nodes: WikiGraphNode[] = payload.nodes.map((n) => {
    const internal = nodeFromPayload(n);
    lookup.set(n.id, internal);
    return internal;
  });
  const edges: WikiGraphEdge[] = payload.edges.map((e) => edgeFromPayload(e));
  const hasMore: Record<string, boolean> = {};
  for (const entry of payload.hasMore) hasMore[entry.pageId] = entry.hasMore;
  return {
    focalPageId: payload.focalPageId,
    depth: payload.depth,
    atTime: payload.atTime,
    nodes,
    edges,
    hasMore,
  };
}

function nodeFromPayload(p: WikiSubgraphPage): WikiGraphNode {
  return {
    id: p.id,
    slug: p.slug,
    label: p.title,
    pageType: p.type as WikiPageType,
    summaryPreview: p.summary ?? undefined,
    lastCompiledAt: p.lastCompiledAt ?? p.updatedAt,
    status: normalizeStatus(p.status),
    primaryAgentIds: [],
  };
}

function edgeFromPayload(e: WikiSubgraphLink): WikiGraphEdge {
  return {
    id: e.id,
    source: e.fromPageId,
    target: e.toPageId,
    sectionSlug: undefined,
    contextExcerpt: e.context ?? undefined,
    firstSeenAt: e.firstSeenAt ?? new Date(0).toISOString(),
    lastSeenAt: e.lastSeenAt ?? new Date().toISOString(),
    isCurrent: e.isCurrent ?? true,
    weight: e.weight ?? undefined,
  };
}

function normalizeStatus(s: string): "ACTIVE" | "STALE" | "ARCHIVED" {
  const upper = s.toUpperCase();
  if (upper === "ARCHIVED") return "ARCHIVED";
  if (upper === "STALE") return "STALE";
  return "ACTIVE";
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
