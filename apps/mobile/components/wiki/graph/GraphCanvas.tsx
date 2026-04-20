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
import type { WikiSubgraph } from "./types";

interface GraphCanvasProps {
  subgraph: WikiSubgraph;
  selectedNodeId: string | null;
  transform: ReturnType<typeof useGraphCamera>["transform"];
  /**
   * Node ids to render dimmed (15% opacity for the node, no label).
   * Edges are dimmed when both endpoints are dimmed.
   */
  dimmedNodeIds?: Set<string>;
  /**
   * When true, render each node's label inside the transformed group so
   * it tracks the camera natively. Intended for small graphs where
   * labels don't overlap.
   */
  showLabels?: boolean;
}

const SELECTION_RING_OFFSET = 4;
const DIM_OPACITY = 0.15;
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
  dimmedNodeIds,
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
            !!dimmedNodeIds && dimmedNodeIds.has(a.id) && dimmedNodeIds.has(b.id);
          return (
            <Line
              key={e.id}
              p1={vec(a.x, a.y)}
              p2={vec(b.x, b.y)}
              color={edgeColor}
              strokeWidth={1}
              opacity={edgeDimmed ? DIM_OPACITY : 1}
            />
          );
        })}
        {subgraph.nodes.map((n) => {
          if (n.x == null || n.y == null) return null;
          const isDimmed = !!dimmedNodeIds && dimmedNodeIds.has(n.id);
          return (
            <Circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={nodeRadius}
              color={getNodeColor(n.pageType, scheme)}
              opacity={isDimmed ? DIM_OPACITY : 1}
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
              if (dimmedNodeIds && dimmedNodeIds.has(n.id)) return null;
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
