import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  StyleSheet,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS } from "react-native-reanimated";
import { COLORS } from "@/lib/theme";
import { GraphCanvas } from "./GraphCanvas";
import { loadGraphState, saveGraphState } from "./graphStateCache";
import { type SimConfig, useForceSimulation } from "./hooks/useForceSimulation";
import { useGraphCamera } from "./hooks/useGraphCamera";
import { computeFit } from "./layout/fitBounds";
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
  /**
   * Show an activity indicator during the pre-reveal delay. Default true.
   * The detail-screen embed opts out because the 1-hop graph is small
   * and the reveal feels instant.
   */
  showRevealLoader?: boolean;
  /**
   * When true, render each node's label as an absolutely-positioned
   * overlay beneath the node. Intended for small graphs (e.g. 1-hop
   * detail neighborhoods) where labels don't overlap. Default false.
   */
  showLabels?: boolean;
  /**
   * Per-call sim tuning. Defaults are tuned for dense agent graphs;
   * small neighborhoods look better with larger `linkDistance`,
   * `chargeStrength`, and `collideRadius`.
   */
  simConfig?: SimConfig;
  /**
   * Opaque key used to persist camera + node positions across
   * unmount/remount (e.g. when the user drills into a detail screen and
   * comes back). Usually `${tenantId}:${agentId}`. When omitted, state
   * is not persisted and the graph cold-starts on every mount.
   */
  cacheKey?: string;
}

const PRE_REVEAL_MS = 1000;
const FIT_ANIM_MS = 700;
const FIT_START_SCALE_MULT = 0.65;

/**
 * Pure renderer of a wiki subgraph. Owns the sim + camera + composed
 * gesture; selection state is lifted to the parent.
 *
 * Reveal strategy: let the sim crunch invisibly for PRE_REVEAL_MS so the
 * nodes have time to spread out of the initial tight cluster. Then run a
 * single eased zoom-in: seat the camera at a slight zoom-out from the
 * fit target and animate to the fit over FIT_ANIM_MS. After that, the
 * camera is static until the user pans/pinches. No later auto-animation.
 */
export function KnowledgeGraph({
  subgraph,
  selectedNodeId,
  onSelectNode,
  dimmedNodeIds,
  showRevealLoader = true,
  showLabels = false,
  simConfig,
  cacheKey,
}: KnowledgeGraphProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((prev) =>
      prev && prev.width === w && prev.height === h ? prev : { width: w, height: h },
    );
  }, []);

  const userInteractedRef = useRef(false);
  const markUserInteracted = useCallback(() => {
    userInteractedRef.current = true;
  }, []);
  const camera = useGraphCamera(0, 0, {
    onUserGesture: markUserInteracted,
  });

  // Sim runs from mount regardless of reveal — the 1s buffer lets node
  // positions stabilize enough for a sensible fit target.
  useForceSimulation(subgraph.nodes, subgraph.edges, simConfig);

  const [revealed, setRevealed] = useState(false);

  // Try to rehydrate from the module-level cache first. If there's a
  // snapshot for this cacheKey, apply it and skip the reveal animation
  // so the user lands on the exact view they left.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (!cacheKey || !size) return;
    const cached = loadGraphState(cacheKey);
    if (!cached) return;
    restoredRef.current = true;
    for (const n of subgraph.nodes) {
      const p = cached.positions.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    }
    camera.tx.value = cached.tx;
    camera.ty.value = cached.ty;
    camera.scale.value = cached.scale;
    setRevealed(true);
  }, [cacheKey, size, subgraph, camera]);

  // Split the reveal into two phases so subgraph re-emits don't stomp
  // the user's camera:
  //   (1) A mount-only timer flips `preRevealComplete` after PRE_REVEAL_MS.
  //       Having no deps means a urql re-emit can't clear or reschedule it.
  //   (2) A second effect, gated by a `hasRevealedRef`, runs the fit
  //       animation exactly once per component instance.
  const [preRevealComplete, setPreRevealComplete] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPreRevealComplete(true), PRE_REVEAL_MS);
    return () => clearTimeout(t);
  }, []);

  const hasRevealedRef = useRef(false);
  useEffect(() => {
    if (!preRevealComplete || !size) return;
    if (restoredRef.current) return;
    if (hasRevealedRef.current) return;
    if (userInteractedRef.current) return;
    hasRevealedRef.current = true;
    const target = computeFit(subgraph.nodes, size.width, size.height, {
      maxScale: 1,
    });
    camera.tx.value = target.tx;
    camera.ty.value = target.ty;
    camera.scale.value = target.scale * FIT_START_SCALE_MULT;
    camera.animateTo(target, FIT_ANIM_MS);
    setRevealed(true);
  }, [preRevealComplete, size, subgraph, camera]);

  // Snapshot camera + node positions on unmount so a re-mount (e.g. after
  // drilling into a detail screen and coming back) can restore state.
  // Live refs so the cleanup captures the latest values, not render-time
  // closures.
  const snapRef = useRef({ subgraph, camera, cacheKey });
  snapRef.current = { subgraph, camera, cacheKey };
  useEffect(() => {
    return () => {
      const { subgraph: sg, camera: cam, cacheKey: ck } = snapRef.current;
      if (!ck) return;
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of sg.nodes) {
        if (typeof n.x === "number" && typeof n.y === "number") {
          positions.set(n.id, { x: n.x, y: n.y });
        }
      }
      saveGraphState(ck, {
        tx: cam.tx.value,
        ty: cam.ty.value,
        scale: cam.scale.value,
        positions,
      });
    };
  }, []);

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
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={[
            styles.canvasWrap,
            size ? { width: size.width, height: size.height } : { flex: 1 },
          ]}
        >
          {size && revealed ? (
            <GraphCanvas
              subgraph={subgraph}
              selectedNodeId={selectedNodeId}
              transform={camera.transform}
              dimmedNodeIds={dimmedNodeIds}
              showLabels={showLabels}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
      {showRevealLoader && !revealed ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={COLORS.dark.mutedForeground} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark.background },
  canvasWrap: { backgroundColor: "transparent" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
