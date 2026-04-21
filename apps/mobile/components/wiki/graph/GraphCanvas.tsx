import {
  Canvas,
  Circle,
  Group,
  Line,
  Text as SkiaText,
  matchFont,
  vec,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { Platform, StyleSheet, useColorScheme } from "react-native";
import { COLORS } from "@/lib/theme";
import type { useGraphCamera } from "./hooks/useGraphCamera";
import {
  type ColorScheme,
  getEdgeColor,
  getNodeColor,
  getNodeRadius,
} from "./layout/typeStyle";
import type { GraphFilter, WikiSubgraph } from "./types";

type NodeVisualState = "matched" | "neighbor" | "other";

function classifyNode(
  id: string,
  filter: GraphFilter | null | undefined,
): NodeVisualState {
  if (!filter) return "matched";
  if (filter.matchedIds.has(id)) return "matched";
  if (filter.neighborIds.has(id)) return "neighbor";
  return "other";
}

interface GraphCanvasProps {
  subgraph: WikiSubgraph;
  selectedNodeId: string | null;
  transform: ReturnType<typeof useGraphCamera>["transform"];
  /**
   * Search filter. `null`/`undefined` → every node + edge renders
   * full color. Non-null → matched full color; 1-hop neighbors at 15%
   * fill + a stroked outline ring in their type color; everything
   * else at 15% fill, no ring. Edges render at full opacity when at
   * least one endpoint is matched, muted otherwise.
   */
  filter?: GraphFilter | null;
  /**
   * When true, render each node's label inside the transformed group so
   * it tracks the camera natively. Intended for small graphs where
   * labels don't overlap.
   */
  showLabels?: boolean;
}

const SELECTION_RING_OFFSET = 4;
const NEIGHBOR_RING_STROKE = 1.5;
// Ring sits inside the sphere (centered on a slightly smaller radius)
// so the node's overall footprint doesn't grow when it becomes a
// neighbor. Inset by half the stroke width keeps the stroke's outer
// edge flush with the filled circle's outer edge.
const NEIGHBOR_RING_INSET = NEIGHBOR_RING_STROKE / 2;
const DIM_OPACITY = 0.15;
// Default edge opacity. Kept well below 1 so connector lines support the
// nodes rather than overpower them — against the black canvas, `mutedForeground`
// at full opacity reads as near-white and crowds out labels at high edge
// density. 0.4 keeps edges clearly visible without competing for attention.
const EDGE_OPACITY = 0.4;
const LABEL_FONT_SIZE = 11;
const LABEL_GAP = 6;
const LABEL_MAX_CHARS = 18;

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export function GraphCanvas({
  subgraph,
  selectedNodeId,
  transform,
  filter,
  showLabels = false,
}: GraphCanvasProps) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === "light" ? "light" : "dark";

  const nodesById = useMemo(() => {
    const m = new Map<string, (typeof subgraph.nodes)[number]>();
    for (const n of subgraph.nodes) m.set(n.id, n);
    return m;
  }, [subgraph.nodes]);

  // Skia font for labels. `matchFont` returns a stable font object; memoize
  // so we don't re-instantiate on every render.
  const labelFont = useMemo(() => {
    if (!showLabels) return null;
    return matchFont({
      fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" })!,
      fontSize: LABEL_FONT_SIZE,
      fontWeight: "500",
    });
  }, [showLabels]);

  const nodeRadius = getNodeRadius();
  const edgeColor = getEdgeColor(scheme);
  const labelColor = COLORS[scheme].foreground;
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null;

  return (
    <Canvas style={styles.canvas}>
      <Group transform={transform}>
        {subgraph.edges.map((e) => {
          const a =
            typeof e.source === "string" ? nodesById.get(e.source) : e.source;
          const b =
            typeof e.target === "string" ? nodesById.get(e.target) : e.target;
          if (
            !a ||
            !b ||
            a.x == null ||
            a.y == null ||
            b.x == null ||
            b.y == null
          ) {
            return null;
          }
          const edgeDimmed =
            !!filter && !filter.matchedIds.has(a.id) && !filter.matchedIds.has(b.id);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= nodeRadius * 2) return null;
          const ux = dx / dist;
          const uy = dy / dist;
          return (
            <Line
              key={e.id}
              p1={vec(a.x + ux * nodeRadius, a.y + uy * nodeRadius)}
              p2={vec(b.x - ux * nodeRadius, b.y - uy * nodeRadius)}
              color={edgeColor}
              strokeWidth={1}
              opacity={edgeDimmed ? DIM_OPACITY : EDGE_OPACITY}
            />
          );
        })}
        {subgraph.nodes.map((n) => {
          if (n.x == null || n.y == null) return null;
          const state = classifyNode(n.id, filter);
          const nodeColor = getNodeColor(n.pageType, scheme);
          if (state === "matched") {
            return (
              <Circle
                key={n.id}
                cx={n.x}
                cy={n.y}
                r={nodeRadius}
                color={nodeColor}
                opacity={1}
              />
            );
          }
          if (state === "neighbor") {
            return (
              <Group key={n.id}>
                <Circle
                  cx={n.x}
                  cy={n.y}
                  r={nodeRadius}
                  color={nodeColor}
                  opacity={DIM_OPACITY}
                />
                <Circle
                  cx={n.x}
                  cy={n.y}
                  r={nodeRadius - NEIGHBOR_RING_INSET}
                  color={nodeColor}
                  style="stroke"
                  strokeWidth={NEIGHBOR_RING_STROKE}
                />
              </Group>
            );
          }
          return (
            <Circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={nodeRadius}
              color={nodeColor}
              opacity={DIM_OPACITY}
            />
          );
        })}
        {selectedNode && selectedNode.x != null && selectedNode.y != null ? (
          <Circle
            cx={selectedNode.x}
            cy={selectedNode.y}
            r={nodeRadius + SELECTION_RING_OFFSET}
            color={getNodeColor(selectedNode.pageType, scheme)}
            style="stroke"
            strokeWidth={2}
          />
        ) : null}
        {showLabels && labelFont
          ? subgraph.nodes.map((n) => {
              if (n.x == null || n.y == null) return null;
              if (classifyNode(n.id, filter) !== "matched") return null;
              const text = truncate(n.label, LABEL_MAX_CHARS);
              const w = labelFont.measureText(text).width;
              return (
                <SkiaText
                  key={`label-${n.id}`}
                  x={n.x - w / 2}
                  y={n.y + nodeRadius + LABEL_GAP + LABEL_FONT_SIZE}
                  text={text}
                  font={labelFont}
                  color={labelColor}
                />
              );
            })
          : null}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
