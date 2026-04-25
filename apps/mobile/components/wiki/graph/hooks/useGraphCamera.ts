import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SCALE_MAX, SCALE_MIN } from "../layout/typeStyle";

const FIT_DURATION_MS = 600;
const FIT_EASING = Easing.out(Easing.cubic);

export interface CameraTarget {
  tx: number;
  ty: number;
  scale: number;
}

interface UseGraphCameraOptions {
  /** Fired on the JS thread the first time the user pans or pinches. */
  onUserGesture?: () => void;
}

export function useGraphCamera(
  initialTx = 0,
  initialTy = 0,
  options: UseGraphCameraOptions = {},
) {
  const { onUserGesture } = options;
  const tx = useSharedValue(initialTx);
  const ty = useSharedValue(initialTy);
  const scale = useSharedValue(1);

  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startScale = useSharedValue(1);
  const pinchScreenX = useSharedValue(0);
  const pinchScreenY = useSharedValue(0);
  const pinchWorldX = useSharedValue(0);
  const pinchWorldY = useSharedValue(0);
  const hasPinchAnchor = useSharedValue(false);
  // Guards pan against concurrent pinch updates. `Gesture.Simultaneous`
  // fires both handlers per frame; on real devices the pan handler can
  // stomp pinch's focal-preserving tx/ty even when pinch reads the live
  // centroid. While pinching, pan.onUpdate records but doesn't apply
  // translation; on pinch end we rebase pan to that recorded translation
  // so a lingering finger resumes without replaying the full pinch-time drag.
  const isPinching = useSharedValue(false);
  const panOffsetX = useSharedValue(0);
  const panOffsetY = useSharedValue(0);
  const lastPanTranslationX = useSharedValue(0);
  const lastPanTranslationY = useSharedValue(0);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onStart(() => {
        cancelAnimation(tx);
        cancelAnimation(ty);
        cancelAnimation(scale);
        if (onUserGesture) runOnJS(onUserGesture)();
        startTx.value = tx.value;
        startTy.value = ty.value;
        panOffsetX.value = 0;
        panOffsetY.value = 0;
        lastPanTranslationX.value = 0;
        lastPanTranslationY.value = 0;
      })
      .onUpdate((e) => {
        lastPanTranslationX.value = e.translationX;
        lastPanTranslationY.value = e.translationY;
        // Skip pan writes during an active pinch — pinch owns tx/ty while
        // two fingers are down. Without this early-return a concurrent
        // pan.onUpdate can overwrite pinch's focal-preserving tx/ty and
        // the user sees the viewport "jump" away from where they zoomed.
        if (isPinching.value) return;
        tx.value = startTx.value + e.translationX - panOffsetX.value;
        ty.value = startTy.value + e.translationY - panOffsetY.value;
      });

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        cancelAnimation(tx);
        cancelAnimation(ty);
        cancelAnimation(scale);
        if (onUserGesture) runOnJS(onUserGesture)();
        startScale.value = scale.value;
        startTx.value = tx.value;
        startTy.value = ty.value;
        // Wait for the first valid two-finger update before choosing the
        // pinch anchor. RNGH can report transient focal samples while
        // the recognizer activates.
        hasPinchAnchor.value = false;
        isPinching.value = true;
      })
      .onUpdate((e) => {
        const pointerCount = (
          e as typeof e & { numberOfPointers?: number }
        ).numberOfPointers;
        if (typeof pointerCount === "number" && pointerCount < 2) return;
        if (!Number.isFinite(e.focalX) || !Number.isFinite(e.focalY)) return;
        const next = Math.min(
          SCALE_MAX,
          Math.max(SCALE_MIN, startScale.value * e.scale),
        );
        if (!hasPinchAnchor.value) {
          const currentScale = scale.value;
          if (currentScale <= 0) return;
          pinchScreenX.value = e.focalX;
          pinchScreenY.value = e.focalY;
          pinchWorldX.value = (e.focalX - tx.value) / currentScale;
          pinchWorldY.value = (e.focalY - ty.value) / currentScale;
          hasPinchAnchor.value = true;
        }
        // Pinch invariant: the graph coordinate that starts under the
        // two-finger midpoint stays at that same screen coordinate for
        // the whole pinch. Native focal points can drift or collapse
        // toward one finger near edges; using them as a live screen
        // target makes the camera appear to jump.
        tx.value = pinchScreenX.value - pinchWorldX.value * next;
        ty.value = pinchScreenY.value - pinchWorldY.value * next;
        scale.value = next;
      })
      .onEnd(() => {
        // Rebase pan's baseline so if the user keeps a finger down, the
        // transition from pinch -> pan doesn't jump by the full accumulated
        // translation since pan.onStart fired.
        startTx.value = tx.value;
        startTy.value = ty.value;
        panOffsetX.value = lastPanTranslationX.value;
        panOffsetY.value = lastPanTranslationY.value;
        isPinching.value = false;
      })
      .onFinalize(() => {
        // Defensive — covers gesture termination paths (cancel, system
        // interrupt) that may not fire onEnd.
        startTx.value = tx.value;
        startTy.value = ty.value;
        panOffsetX.value = lastPanTranslationX.value;
        panOffsetY.value = lastPanTranslationY.value;
        isPinching.value = false;
        hasPinchAnchor.value = false;
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [
    tx,
    ty,
    scale,
    startTx,
    startTy,
    startScale,
    pinchScreenX,
    pinchScreenY,
    pinchWorldX,
    pinchWorldY,
    hasPinchAnchor,
    isPinching,
    panOffsetX,
    panOffsetY,
    lastPanTranslationX,
    lastPanTranslationY,
    onUserGesture,
  ]);

  // Stable identity so effects can depend on `camera` without retriggering
  // every render (sim ticks at 30Hz; the parent re-renders that often).
  return useMemo(
    () => ({
      tx,
      ty,
      scale,
      transform,
      gesture,
      animateTo: (target: CameraTarget, duration = FIT_DURATION_MS) => {
        const cfg = { duration, easing: FIT_EASING };
        tx.value = withTiming(target.tx, cfg);
        ty.value = withTiming(target.ty, cfg);
        scale.value = withTiming(target.scale, cfg);
      },
      stepToward: (target: CameraTarget, alpha = 0.15) => {
        tx.value = tx.value + (target.tx - tx.value) * alpha;
        ty.value = ty.value + (target.ty - ty.value) * alpha;
        scale.value = scale.value + (target.scale - scale.value) * alpha;
      },
    }),
    [tx, ty, scale, transform, gesture],
  );
}
