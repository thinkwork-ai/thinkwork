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
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

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
      })
      .onUpdate((e) => {
        tx.value = startTx.value + e.translationX;
        ty.value = startTy.value + e.translationY;
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
        focalX.value = e.focalX;
        focalY.value = e.focalY;
      })
      .onUpdate((e) => {
        const next = Math.min(
          SCALE_MAX,
          Math.max(SCALE_MIN, startScale.value * e.scale),
        );
        const ratio = next / startScale.value;
        tx.value = focalX.value - (focalX.value - startTx.value) * ratio;
        ty.value = focalY.value - (focalY.value - startTy.value) * ratio;
        scale.value = next;
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [tx, ty, scale, startTx, startTy, startScale, focalX, focalY, onUserGesture]);

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
