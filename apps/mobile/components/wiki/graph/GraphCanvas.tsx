import {
  Canvas,
  Circle,
  Group,
  Line,
  Path,
  Text as SkiaText,
  matchFont,
  vec,
} from "@shopify/react-native-skia";
import {
  classifyNode,
  communityColor,
  darkenColor,
  degreeRadius,
  wrapLabelLines,
} from "@thinkwork/graph-core";
import { useMemo } from "react";
import { Platform, StyleSheet } from "react-native";
import type { useGraphCamera } from "./hooks/useGraphCamera";
import type { GraphFilter, WikiGraphNode, WikiSubgraph } from "./types";

type SkFont = ReturnType<typeof matchFont>;

interface GraphCanvasProps {
  subgraph: WikiSubgraph;
  selectedNodeId: string | null;
  transform: ReturnType<typeof useGraphCamera>["transform"];
  /**
   * Search filter. `null`/`undefined` → every node + edge renders at full
   * color. Non-null → matched nodes full color; 1-hop neighbors at 15%
   * fill + a stroked ring in the node's community color; everything else
   * at 15% fill, no ring. Edges brighten when at least one endpoint is
   * matched and mute otherwise — but only *while filtering* (see the web
   * `MemoryGraph` link painter this mirrors).
   */
  filter?: GraphFilter | null;
  /** Community id per node id — drives node fill color (Louvain). */
  communityByNode: ReadonlyMap<string, number>;
  /** Degree (connection count) per node id — drives disc radius. */
  degreeById: ReadonlyMap<string, number>;
  /** Max degree in the graph, for normalizing `degreeRadius`. */
  maxDegree: number;
  /**
   * Whether node + edge relationship labels render this frame. The parent
   * gates this on the zoom scale (`labelsVisibleAtScale`) plus the label
   * toggle, matching web's `nodeLabelVisible` / `linkLabelVisible`.
   */
  labelsVisible?: boolean;
}

const SELECTION_RING_OFFSET = 4;
const NEIGHBOR_RING_STROKE = 1.5;
const NEIGHBOR_RING_INSET = NEIGHBOR_RING_STROKE / 2;
const DIM_OPACITY = 0.15;
const LABEL_LINE_HEIGHT = 1.15;
const EDGE_LABEL_FONT_SIZE = 7;
const EDGE_ARROW_SIZE = 4;

// Slate connector color matching web (`rgba(148,163,184,a)`), with the
// exact bright/dim alphas the web link painter uses so the two platforms
// mute identically.
const EDGE_COLOR_FILTER_BRIGHT = "rgba(148,163,184,0.3)";
const EDGE_COLOR_FILTER_DIM = "rgba(148,163,184,0.05)";
const EDGE_COLOR_BRIGHT = "rgba(148,163,184,0.9)";
const EDGE_COLOR_DIM = "rgba(148,163,184,0.15)";

const LABEL_FONT_FAMILY = Platform.select({
  ios: "Helvetica",
  default: "sans-serif",
})!;

/** Font size for a node's in-disc label — scales with the disc so big
 *  hubs get bigger text (mirrors web's `r * 0.32`). */
function labelFontSize(radius: number): number {
  return Math.max(3.5, radius * 0.32);
}

export function GraphCanvas({
  subgraph,
  selectedNodeId,
  transform,
  filter,
  communityByNode,
  degreeById,
  maxDegree,
  labelsVisible = false,
}: GraphCanvasProps) {
  const nodesById = useMemo(() => {
    const m = new Map<string, WikiGraphNode>();
    for (const n of subgraph.nodes) m.set(n.id, n);
    return m;
  }, [subgraph.nodes]);

  const radiusFor = useMemo(() => {
    const max = Math.max(1, maxDegree);
    return (id: string) => degreeRadius(degreeById.get(id) ?? 1, max);
  }, [degreeById, maxDegree]);

  const colorFor = useMemo(
    () => (id: string) => communityColor(communityByNode.get(id)),
    [communityByNode],
  );

  // Skia fonts are fixed-size, but disc labels scale with radius. Cache one
  // font per distinct (rounded) size so we don't re-instantiate per node.
  const nodeFontFor = useMemo(() => {
    const cache = new Map<number, SkFont>();
    return (size: number): SkFont => {
      const key = Math.round(size * 2) / 2;
      let font = cache.get(key);
      if (!font) {
        font = matchFont({
          fontFamily: LABEL_FONT_FAMILY,
          fontSize: key,
          fontWeight: "600",
        });
        cache.set(key, font);
      }
      return font;
    };
  }, []);

  const edgeFont = useMemo(
    () =>
      matchFont({
        fontFamily: LABEL_FONT_FAMILY,
        fontSize: EDGE_LABEL_FONT_SIZE,
        fontWeight: "500",
      }),
    [],
  );

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null;
  const filtering = !!filter;

  return (
    <Canvas style={styles.canvas}>
      <Group transform={transform}>
        {/* Edges: trimmed line + arrowhead, with an inline relationship
            label when labels are on and the segment has room. */}
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
          const ra = radiusFor(a.id);
          const rb = radiusFor(b.id);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const sourceTrim = ra + 1.5;
          const targetTrim = rb + 1.5;
          if (dist <= sourceTrim + targetTrim) return null;
          const ux = dx / dist;
          const uy = dy / dist;
          const sx = a.x + ux * sourceTrim;
          const sy = a.y + uy * sourceTrim;
          const tx = b.x - ux * targetTrim;
          const ty = b.y - uy * targetTrim;
          const lineLen = dist - sourceTrim - targetTrim;

          const bright =
            !filter ||
            filter.matchedIds.has(a.id) ||
            filter.matchedIds.has(b.id);
          const color = filtering
            ? bright
              ? EDGE_COLOR_FILTER_BRIGHT
              : EDGE_COLOR_FILTER_DIM
            : bright
              ? EDGE_COLOR_BRIGHT
              : EDGE_COLOR_DIM;

          // Arrowhead: a filled triangle whose tip sits on the target rim.
          const arrow = `M ${tx} ${ty} L ${
            tx - ux * EDGE_ARROW_SIZE - uy * (EDGE_ARROW_SIZE * 0.5)
          } ${ty - uy * EDGE_ARROW_SIZE + ux * (EDGE_ARROW_SIZE * 0.5)} L ${
            tx - ux * EDGE_ARROW_SIZE + uy * (EDGE_ARROW_SIZE * 0.5)
          } ${ty - uy * EDGE_ARROW_SIZE - ux * (EDGE_ARROW_SIZE * 0.5)} Z`;

          const rawLabel = e.label || undefined;
          const mx = (sx + tx) / 2;
          const my = (sy + ty) / 2;
          let labeled = false;
          let labelWidth = 0;
          let angle = 0;
          if (labelsVisible && rawLabel) {
            labelWidth = edgeFont.measureText(rawLabel).width;
            const gap = labelWidth + 10;
            if (lineLen > gap + 12) {
              labeled = true;
              angle = Math.atan2(dy, dx);
              if (angle > Math.PI / 2) angle -= Math.PI;
              else if (angle < -Math.PI / 2) angle += Math.PI;
            }
          }

          return (
            <Group key={e.id}>
              {labeled ? (
                <>
                  <Line
                    p1={vec(sx, sy)}
                    p2={vec(
                      mx - (ux * (labelWidth + 10)) / 2,
                      my - (uy * (labelWidth + 10)) / 2,
                    )}
                    color={color}
                    strokeWidth={1}
                  />
                  <Line
                    p1={vec(
                      mx + (ux * (labelWidth + 10)) / 2,
                      my + (uy * (labelWidth + 10)) / 2,
                    )}
                    p2={vec(tx, ty)}
                    color={color}
                    strokeWidth={1}
                  />
                  <Group
                    transform={[
                      { translateX: mx },
                      { translateY: my },
                      { rotate: angle },
                    ]}
                  >
                    <SkiaText
                      x={-labelWidth / 2}
                      y={EDGE_LABEL_FONT_SIZE * 0.35}
                      text={rawLabel!}
                      font={edgeFont}
                      color={color}
                    />
                  </Group>
                </>
              ) : (
                <Line
                  p1={vec(sx, sy)}
                  p2={vec(tx, ty)}
                  color={color}
                  strokeWidth={1}
                />
              )}
              <Path path={arrow} color={color} style="fill" />
            </Group>
          );
        })}

        {/* Nodes: community-colored disc + rim; neighbors get a full-alpha
            community-color ring; non-matches dim to 15%. */}
        {subgraph.nodes.map((n) => {
          if (n.x == null || n.y == null) return null;
          const state = classifyNode(n.id, filter ?? null);
          const alpha = state === "matched" ? 1 : DIM_OPACITY;
          const r = radiusFor(n.id);
          const color = colorFor(n.id);
          return (
            <Group key={n.id}>
              <Circle cx={n.x} cy={n.y} r={r} color={color} opacity={alpha} />
              {state === "neighbor" ? (
                <Circle
                  cx={n.x}
                  cy={n.y}
                  r={r - NEIGHBOR_RING_INSET}
                  color={color}
                  style="stroke"
                  strokeWidth={NEIGHBOR_RING_STROKE}
                />
              ) : (
                <Circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  color={darkenColor(color)}
                  style="stroke"
                  strokeWidth={Math.max(0.75, r * 0.05)}
                  opacity={alpha}
                />
              )}
            </Group>
          );
        })}

        {/* Node labels: wrapped, centered, white, weight-600, inside the
            disc (neo4j style) — drawn above every disc so a neighbor disc
            can't cover a matched node's text. */}
        {labelsVisible
          ? subgraph.nodes.map((n) => {
              if (n.x == null || n.y == null) return null;
              const state = classifyNode(n.id, filter ?? null);
              const alpha = state === "matched" ? 1 : DIM_OPACITY;
              const r = radiusFor(n.id);
              const fontSize = labelFontSize(r);
              const font = nodeFontFor(fontSize);
              const lines = wrapLabelLines(
                (s) => font.measureText(s).width,
                n.label ?? "",
                r * 1.7,
                3,
              );
              if (lines.length === 0) return null;
              const lineHeight = fontSize * LABEL_LINE_HEIGHT;
              const y0 = n.y - ((lines.length - 1) / 2) * lineHeight;
              return (
                <Group key={`label-${n.id}`} opacity={alpha}>
                  {lines.map((line, i) => {
                    const w = font.measureText(line).width;
                    return (
                      <SkiaText
                        key={i}
                        x={n.x! - w / 2}
                        // Skia text y is the baseline; nudge down so the
                        // line's optical center lands on y0 + i*lineHeight.
                        y={y0 + i * lineHeight + fontSize * 0.35}
                        text={line}
                        font={font}
                        color="#ffffff"
                      />
                    );
                  })}
                </Group>
              );
            })
          : null}

        {selectedNode && selectedNode.x != null && selectedNode.y != null ? (
          <Circle
            cx={selectedNode.x}
            cy={selectedNode.y}
            r={radiusFor(selectedNode.id) + SELECTION_RING_OFFSET}
            color={colorFor(selectedNode.id)}
            style="stroke"
            strokeWidth={2}
          />
        ) : null}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
