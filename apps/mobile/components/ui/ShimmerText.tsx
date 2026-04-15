import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";

/**
 * Character-sweep shimmer text — the same effect used by the chat
 * TypingIndicator's "Processing..." label, extracted so it can be reused for
 * other loading placeholders. Each character's color interpolates from
 * `dimColor` → `brightColor` → `dimColor` as a highlight window sweeps
 * across the text and loops.
 */

const SHIMMER_WINDOW = 3;
const CHAR_DURATION = 120;

interface ShimmerTextProps {
  text: string;
  fontSize?: number;
  lineHeight?: number;
  fontFamily?: string;
  dimColor?: string;
  brightColor?: string;
}

export function ShimmerText({
  text,
  fontSize = 14,
  lineHeight = 18,
  fontFamily,
  dimColor = "#6b7280",
  brightColor = "#d1d5db",
}: ShimmerTextProps) {
  const step = useRef(new Animated.Value(0)).current;
  const totalSteps = text.length + SHIMMER_WINDOW;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(step, {
        toValue: totalSteps,
        duration: CHAR_DURATION * totalSteps,
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [step, totalSteps]);

  return (
    <Animated.Text style={{ fontSize, lineHeight, fontFamily }}>
      {text.split("").map((char, i) => {
        const color = step.interpolate({
          inputRange: [i, i + SHIMMER_WINDOW / 2, i + SHIMMER_WINDOW],
          outputRange: [dimColor, brightColor, dimColor],
          extrapolate: "clamp",
        });
        return (
          <Animated.Text key={i} style={{ color, fontSize, lineHeight, fontFamily }}>
            {char}
          </Animated.Text>
        );
      })}
    </Animated.Text>
  );
}
