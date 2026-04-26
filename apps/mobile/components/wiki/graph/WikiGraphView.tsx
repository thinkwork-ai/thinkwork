import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  type WikiGraphEdgeFromServer,
  type WikiGraphNodeFromServer,
  type WikiGraphPayload,
  useWikiGraph,
} from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";
import type { SimConfig } from "./hooks/useForceSimulation";
import { KnowledgeGraph } from "./KnowledgeGraph";
import {
  NodeDetailModal,
  type NodeDetailModalTarget,
} from "./NodeDetailModal";
import { loadGraphState } from "./graphStateCache";
import type {
  GraphFilter,
  WikiGraphEdge,
  WikiGraphNode,
  WikiPageType,
  WikiSubgraph,
} from "./types";

// Tuned for browsable label mode on the main agent graph (~100-200 nodes).
// Loosened from `WikiDetailSubgraph` (which targets ~10-30 nodes): more
// link distance + collide so ~18-char titles don't crash into adjacent
// nodes at default zoom.
//
// Animation length is driven primarily by the `preTick` call inside
// `KnowledgeGraph`'s label-toggle effect (see `sim.restart(0.3, 40)`).
// Pre-ticking advances convergence offscreen, so the scheduler phase
// here just plays a short low-amplitude settle. `alphaDecay` is a
// modest bump above d3's default (~0.0228) to keep the tail short
// without forcing premature quiesce; `velocityDecay` and
// `quiesceAlpha` stay at their defaults because aggressive values
// either degrade clustering (velocityDecay too high) or produce an
// abrupt stop (quiesceAlpha too high).
const LABEL_MODE_SIM_CONFIG: SimConfig = {
  linkDistance: 85,
  chargeStrength: -850,
  collideRadius: 48,
  xyStrength: 0.04,
  alphaDecay: 0.05,
};

interface WikiGraphViewProps {
  tenantId: string;
  userId: string;
  /** @deprecated Use userId. */
  agentId?: string;
  /**
   * Optional: route param kept for backwards compat with existing callers,
   * but the default view is "show all pages for this agent".
   */
  initialFocalPageId?: string | null;
  /**
   * When non-empty, 3-state rendering: matched nodes full color, 1-hop
   * neighbors of a match render muted with a colored outline ring in
   * their type color, and everything else renders just muted. Edges
   * stay visible — full opacity when at least one endpoint is
   * matched, muted when both are unmatched. Lets the shared "Search
   * wiki…" footer filter the graph in place without restarting the
   * force sim or camera.
   */
  searchQuery?: string;
  /**
   * When true, render node titles beneath each node and use a label-
   * friendly force config so titles don't overlap. Default false (the
   * original dense, label-free constellation).
   */
  showLabels?: boolean;
}

/**
 * Top-level wiring for the graph viewer. Nodes have no labels, so a tap
 * opens a centered `NodeDetailModal` showing the page's wiki body. From
 * there, the user can open the full detail screen via the external-link
 * icon. This keeps the common case (preview → dismiss) cheap without
 * forcing a full navigation round-trip.
 */
export function WikiGraphView({
  tenantId,
  userId,
  agentId,
  searchQuery,
  showLabels = false,
}: WikiGraphViewProps) {
  const router = useRouter();
  const scopeUserId = userId ?? agentId;
  const { graph, loading, error, refetch } = useWikiGraph({
    tenantId,
    userId: scopeUserId,
  });

  // Background refresh every time the graph view mounts (i.e. toggled
  // back from list view). There's no pull-to-refresh in graph mode, so
  // this is the user's only guarantee of fresh data. Positions + camera
  // survive via the prevInternalRef + graphStateCache layers, so the
  // refresh doesn't disturb the visible state.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    refetchRef.current();
  }, []);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const cacheKey = `${tenantId}:${scopeUserId}`;

  // When urql re-emits the query (even with identical content) we get a
  // new `graph` ref and `toInternalSubgraph` produces brand-new node
  // objects. Carry positions forward by id so the layout doesn't snap
  // back to d3's random sunflower on re-emit. Also seed from the module
  // cache on the very first build so cross-mount restores work.
  const prevInternalRef = useRef<WikiSubgraph | null>(null);

  const internalSubgraph = useMemo(() => {
    if (!graph) return null;
    const sub = toInternalSubgraph(graph);
    const prev = prevInternalRef.current;
    if (prev) {
      const byId = new Map<string, WikiGraphNode>(
        prev.nodes.map((n) => [n.id, n]),
      );
      for (const n of sub.nodes) {
        const p = byId.get(n.id);
        if (p && typeof p.x === "number" && typeof p.y === "number") {
          n.x = p.x;
          n.y = p.y;
          n.vx = 0;
          n.vy = 0;
        }
      }
    } else {
      const cached = loadGraphState(cacheKey);
      if (cached) {
        for (const n of sub.nodes) {
          const p = cached.positions.get(n.id);
          if (p) {
            n.x = p.x;
            n.y = p.y;
            n.vx = 0;
            n.vy = 0;
          }
        }
      }
    }
    prevInternalRef.current = sub;
    return sub;
  }, [graph, cacheKey]);

  const selectedTarget: NodeDetailModalTarget | null = useMemo(() => {
    if (!internalSubgraph || !selectedNodeId) return null;
    const node = internalSubgraph.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return null;
    return {
      id: node.id,
      type: node.pageType,
      slug: node.slug,
      title: node.label,
    };
  }, [internalSubgraph, selectedNodeId]);

  // 3-state filter: matched (full color), 1-hop neighbors of a match
  // (muted + colored outline ring), other (muted only). Edges stay
  // visible; full opacity when touching a match, muted otherwise.
  // `null` means no filter active — everything renders full color.
  const filter = useMemo<GraphFilter | null>(() => {
    const q = (searchQuery ?? "").trim().toLowerCase();
    if (!q || !internalSubgraph) return null;
    const matchedIds = new Set<string>();
    for (const n of internalSubgraph.nodes) {
      if ((n.label ?? "").toLowerCase().includes(q)) matchedIds.add(n.id);
    }
    const neighborIds = new Set<string>();
    for (const e of internalSubgraph.edges) {
      const sId = typeof e.source === "string" ? e.source : e.source.id;
      const tId = typeof e.target === "string" ? e.target : e.target.id;
      const sMatched = matchedIds.has(sId);
      const tMatched = matchedIds.has(tId);
      if (sMatched && !tMatched) neighborIds.add(tId);
      else if (tMatched && !sMatched) neighborIds.add(sId);
    }
    return { matchedIds, neighborIds };
  }, [searchQuery, internalSubgraph]);

  const handleOpenFullPage = useCallback(
    (node: NodeDetailModalTarget) => {
      setSelectedNodeId(null);
      // Route's `isWikiPageType` check is case-sensitive (ENTITY/TOPIC/
      // DECISION). Lowercasing yields "Not found"; keep uppercase.
      const base = `/wiki/${encodeURIComponent(node.type)}/${encodeURIComponent(node.slug)}`;
      router.push(`${base}?userId=${encodeURIComponent(scopeUserId)}`);
    },
    [router, scopeUserId],
  );

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
          filter={filter}
          cacheKey={cacheKey}
          showLabels={showLabels}
          simConfig={showLabels ? LABEL_MODE_SIM_CONFIG : undefined}
        />
      )}

      <NodeDetailModal
        tenantId={tenantId}
        userId={scopeUserId}
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
