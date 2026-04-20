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
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { useGraphCamera } from "./hooks/useGraphCamera";
import {
  type ColorScheme,
  getEdgeColor,
  getNodeColor,
  getNodeRadius,
} from "./layout/typeStyle";
import type { WikiSubgraph } from "./types";

interface GraphCanvasProps {
  subgraph: WikiSubgraph;
  width: number;
  height: number;
}

export function GraphCanvas({ subgraph, width, height }: GraphCanvasProps) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === "light" ? "light" : "dark";

  const camera = useGraphCamera(width / 2, height / 2);

  const nodesById = useMemo(() => {
    const m = new Map<string, (typeof subgraph.nodes)[number]>();
    for (const n of subgraph.nodes) m.set(n.id, n);
    return m;
  }, [subgraph.nodes]);

  const labelFont = useMemo(() => {
    const family = Platform.select({
      ios: "Inter",
      default: "Inter",
    });
    return matchFont({ fontFamily: family, fontSize: 11, fontWeight: "500" });
  }, []);

  const nodeRadius = getNodeRadius();
  const edgeColor = getEdgeColor(scheme);

  return (
    <GestureDetector gesture={camera.gesture}>
      <Animated.View style={[styles.canvasWrap, { width, height }]}>
        <Canvas style={styles.canvas}>
          <Group transform={camera.transform}>
            {subgraph.edges.map((e) => {
              const a =
                typeof e.source === "string"
                  ? nodesById.get(e.source)
                  : e.source;
              const b =
                typeof e.target === "string"
                  ? nodesById.get(e.target)
                  : e.target;
              if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) {
                return null;
              }
              return (
                <Line
                  key={e.id}
                  p1={vec(a.x, a.y)}
                  p2={vec(b.x, b.y)}
                  color={edgeColor}
                  strokeWidth={1}
                />
              );
            })}
            {subgraph.nodes.map((n) => {
              if (n.x == null || n.y == null) return null;
              return (
                <Circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={nodeRadius}
                  color={getNodeColor(n.pageType, scheme)}
                />
              );
            })}
            {labelFont
              ? subgraph.nodes.map((n) => {
                  if (n.x == null || n.y == null) return null;
                  return (
                    <SkiaText
                      key={`label-${n.id}`}
                      x={n.x + nodeRadius + 4}
                      y={n.y + 4}
                      text={n.label}
                      font={labelFont}
                      color={scheme === "dark" ? "#fafafa" : "#171717"}
                    />
                  );
                })
              : null}
          </Group>
        </Canvas>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  canvasWrap: { backgroundColor: "transparent" },
  canvas: { flex: 1 },
});
