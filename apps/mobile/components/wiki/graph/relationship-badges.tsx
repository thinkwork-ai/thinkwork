import { communityColor, endpointId } from "@thinkwork/graph-core";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/lib/theme";
import type { WikiGraphEdge, WikiGraphNode } from "./types";

/**
 * Native port of the web `relationship-badges` + `MemoryGraphNodeSheet`
 * relationships section: each connection renders as
 * `[source pill] ── VERB ──▶ [target pill]`, pills colored by the node's
 * Louvain community so they match the graph canvas.
 */
export interface GraphRelationship {
  verb: string;
  direction: "in" | "out";
  otherId: string;
  otherLabel: string;
  otherColor: string;
}

/** Connected edges of `nodeId`, shaped for the relationships section.
 *  `colorForId` supplies each node's community hue so pills match the
 *  canvas coloring. */
export function buildRelationships(
  nodeId: string,
  nodes: readonly WikiGraphNode[],
  edges: readonly WikiGraphEdge[],
  colorForId: (id: string) => string,
): GraphRelationship[] {
  const rows: GraphRelationship[] = [];
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    if (s !== nodeId && t !== nodeId) continue;
    const otherId = s === nodeId ? t : s;
    const other = nodes.find((n) => n.id === otherId);
    rows.push({
      verb: e.label || "mentions",
      direction: s === nodeId ? "out" : "in",
      otherId,
      otherLabel: other?.label ?? otherId,
      otherColor: colorForId(otherId),
    });
  }
  rows.sort((a, b) => a.otherLabel.localeCompare(b.otherLabel));
  return rows;
}

export function communityColorForId(
  communityByNode: ReadonlyMap<string, number>,
): (id: string) => string {
  return (id: string) => communityColor(communityByNode.get(id));
}

function NodeBadge({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.badge,
        { borderColor: color, backgroundColor: `${color}26` },
      ]}
    >
      <Text numberOfLines={1} style={styles.badgeText}>
        {label}
      </Text>
    </Pressable>
  );
}

function RelationshipConnector({ verb }: { verb: string }) {
  return (
    <Text numberOfLines={1} style={styles.connector}>
      {`── ${verb.toUpperCase()} ──▶`}
    </Text>
  );
}

/**
 * The "RELATIONSHIPS" block for a node-detail surface. Mirrors web's
 * `MemoryGraphNodeSheet`: current node on the left/right depending on edge
 * direction, verb connector in the middle. Tapping the other pill
 * re-anchors the detail to that node when `onSelectOther` is provided.
 */
export function RelationshipsSection({
  currentLabel,
  currentColor,
  relationships,
  onSelectOther,
}: {
  currentLabel: string;
  currentColor: string;
  relationships: GraphRelationship[];
  onSelectOther?: (id: string) => void;
}) {
  if (relationships.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Relationships</Text>
      <View style={styles.rows}>
        {relationships.map((r, i) => {
          const current = (
            <NodeBadge label={currentLabel} color={currentColor} />
          );
          const other = (
            <NodeBadge
              label={r.otherLabel}
              color={r.otherColor}
              onPress={
                onSelectOther ? () => onSelectOther(r.otherId) : undefined
              }
            />
          );
          const connector = <RelationshipConnector verb={r.verb} />;
          return (
            <View key={`${r.otherId}-${i}`} style={styles.row}>
              {r.direction === "out" ? (
                <>
                  {current}
                  {connector}
                  {other}
                </>
              ) : (
                <>
                  {other}
                  {connector}
                  {current}
                </>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: {
    color: COLORS.dark.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rows: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: {
    flexShrink: 1,
    maxWidth: "40%",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    color: COLORS.dark.foreground,
    fontSize: 11,
    fontWeight: "500",
  },
  connector: {
    flexShrink: 0,
    color: COLORS.dark.mutedForeground,
    fontSize: 9,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
});
