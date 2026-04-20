import { useCallback } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS } from "react-native-reanimated";
import { COLORS } from "@/lib/theme";
import { GraphCanvas } from "./GraphCanvas";
import { useForceSimulation } from "./hooks/useForceSimulation";
import { useGraphCamera } from "./hooks/useGraphCamera";
import { nearestNode } from "./layout/hitTest";
import type { WikiSubgraph } from "./types";

interface KnowledgeGraphProps {
  subgraph: WikiSubgraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /**
   * Node ids to render at reduced opacity (e.g. when filtered out by the
   * shared search query). Tap-hit testing still considers them.
   */
  dimmedNodeIds?: Set<string>;
}

/**
 * Pure renderer of a wiki subgraph. Owns the sim + camera + composed
 * gesture; selection state is lifted to the parent so the detail sheet
 * can react to it.
 */
export function KnowledgeGraph({
  subgraph,
  selectedNodeId,
  onSelectNode,
  dimmedNodeIds,
}: KnowledgeGraphProps) {
  const { width, height } = useWindowDimensions();
  const camera = useGraphCamera(width / 2, height / 2);

  // Sim mutates node.x/y in place; tick increments trigger re-render.
  useForceSimulation(subgraph.nodes, subgraph.edges);

  const handleTap = useCallback(
    (screenX: number, screenY: number) => {
      const cameraState = {
        tx: camera.tx.value,
        ty: camera.ty.value,
        scale: camera.scale.value,
      };
      const hit = nearestNode(
        cameraState,
        { x: screenX, y: screenY },
        subgraph.nodes,
      );
      onSelectNode(hit ? hit.node.id : null);
    },
    [camera.tx, camera.ty, camera.scale, subgraph.nodes, onSelectNode],
  );

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e) => {
      runOnJS(handleTap)(e.x, e.y);
    });

  const composedGesture = Gesture.Simultaneous(camera.gesture, tapGesture);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.canvasWrap, { width, height }]}>
          <GraphCanvas
            subgraph={subgraph}
            selectedNodeId={selectedNodeId}
            transform={camera.transform}
            dimmedNodeIds={dimmedNodeIds}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark.background },
  canvasWrap: { backgroundColor: "transparent" },
});
