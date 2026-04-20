import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import { SCALE_MAX, SCALE_MIN } from "../layout/typeStyle";

export function useGraphCamera(initialTx = 0, initialTy = 0) {
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
        startTx.value = tx.value;
        startTy.value = ty.value;
      })
      .onUpdate((e) => {
        tx.value = startTx.value + e.translationX;
        ty.value = startTy.value + e.translationY;
      });

    const pinch = Gesture.Pinch()
      .onStart((e) => {
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
  }, [tx, ty, scale, startTx, startTy, startScale, focalX, focalY]);

  return { tx, ty, scale, transform, gesture };
}
